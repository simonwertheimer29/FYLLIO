// app/lib/incidencias.ts
//
// LOS FALLOS, EN NUESTRA BASE (plan maestro 0.4, MEJORAS 207 — decisión de
// Simon, 2026-09-06): no un servicio externo que reciba registros con
// contenido de conversaciones. Lo nuestro se enseña en el producto.
//
// Qué es una incidencia: un fallo que el código YA capturó (un catch, un
// resultado de fallo, una cola que agotó reintentos) y que alguien tiene que
// poder ver sin abrir un log. Qué NO es: un log. Aquí no hay texto de
// paciente, ni teléfono, ni salud — tipo, motivo, origen, referencia (id) y
// escalares técnicos REDACTADOS. Lo que necesita el texto para investigarse
// ya está en el log del agente con su RLS.
//
// Tres reglas de crecimiento (la tabla no puede convertirse en un log):
//   1. Cubo por hora: (clínica, tipo, motivo, referencia, hora) es UNA fila y
//      `veces` cuenta. Los reintentos del mismo turno no abren filas.
//   2. Tope por cliente y hora (TOPE_FILAS_HORA): pasado, lo que llega se
//      acumula en `sistema/tope_incidencias` y se sigue viendo que algo arde.
//   3. Caducidad: `retencionIncidencias` cada día, con plazo declarado.
//
// La campana (notificaciones) NO se toca por cada fallo: se toca cuando el
// fallo es SISTEMÁTICO — UMBRAL_SISTEMATICO referencias distintas de la misma
// (clínica, tipo, motivo) en una hora — o cuando quien registra pide
// `avisar: "siempre"` (un tope de turnos, una cola agotada). Una vez por hora,
// motivo y clínica, como hasta hoy.
//
// Nunca lanza: registrar un fallo no puede producir otro (§9).

import { sql } from "kysely";
import { runWithClienteDb } from "./db/context";
import { currentCliente, type Cliente } from "./airtable";

export type TipoIncidencia = "agente" | "cola" | "envio" | "cron" | "integracion" | "entrada" | "sistema";
export type DetalleIncidencia = Record<string, string | number | boolean | null>;
export type AvisoIncidencia = { titulo: string; mensaje?: string; link?: string };

export type RegistroIncidencia = {
  tipo: TipoIncidencia;
  /** Código corto y estable (snake_case). Nunca texto libre. */
  motivo: string;
  /** Módulo o ruta que registra: 'agente/evaluar-entrante', 'cola/fallo', 'cron/daily'. */
  origen: string;
  clinicaId?: string | null;
  /** Id del objeto afectado (waba_message_id, cita, presupuesto). NUNCA el teléfono. */
  referencia?: string | null;
  /** El error capturado: se resume y REDACTA (`resumirError`), nunca se guarda entero. */
  error?: unknown;
  /** Escalares técnicos (status, intento, ms…). Claves acotadas, strings redactadas. */
  detalle?: DetalleIncidencia;
  /** ¿Un reintento puede arreglarlo? Lo enseña la pantalla y lo usa la cola. */
  reintentable?: boolean;
  /** Cuándo tocar la campana. Default: solo si el fallo es sistemático. */
  avisar?: "sistematico" | "siempre" | "nunca";
  /** Título/mensaje/enlace del aviso de campana. Default por tipo. */
  aviso?: AvisoIncidencia;
  /** Texto que va SOLO a la consola (p. ej. el teléfono), nunca a la tabla. */
  soloLog?: string;
  cliente?: Cliente;
  ahora?: Date;
};

/** Referencias distintas en 60 min a partir de las cuales el fallo es sistemático. */
export const UMBRAL_SISTEMATICO = 3;
/** Filas por cliente y hora a partir de las cuales se deja de abrir filas nuevas. */
export const TOPE_FILAS_HORA = 300;
/** Plazo por defecto de caducidad, en días. Sin contenido personal, es operativo. */
export const RETENCION_DIAS_DEFAULT = 90;
const VENTANA_MIN = 60;
const CLAVES_DETALLE_MAX = 12;
const TEXTO_MAX = 160;

const TITULO_TIPO: Record<TipoIncidencia, string> = {
  agente: "El agente está fallando de forma repetida",
  cola: "La cola de trabajos está fallando de forma repetida",
  envio: "Los envíos están fallando de forma repetida",
  cron: "Una tarea programada está fallando",
  integracion: "Una integración está fallando de forma repetida",
  entrada: "La entrada de mensajes está fallando de forma repetida",
  sistema: "Fyllio está registrando demasiadas incidencias",
};

// ─── Redacción ───────────────────────────────────────────────────────────────
//
// Un mensaje de error es técnico («connect ETIMEDOUT», «column x does not
// exist»)… hasta que no lo es: Postgres cita el valor que no encaja («invalid
// input syntax: "hola qué tal"»), Meta devuelve el número, el modelo puede
// devolver un fragmento del prompt. Se quita lo entrecomillado, los correos y
// las tiras de dígitos, y se trunca. Sobre-redactar es el lado seguro.

export function redactar(texto: string): string {
  return texto
    .replace(/"[^"\n]*"/g, '"…"')
    .replace(/'[^'\n]*'/g, "'…'")
    .replace(/«[^»\n]*»/g, "«…»")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "@…")
    .replace(/\d[\d\s.-]{5,}\d/g, "#…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXTO_MAX);
}

export function resumirError(err: unknown): { error_nombre: string; error_codigo: string | null; error_resumen: string } {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; status?: unknown; statusCode?: unknown };
    const codigo = e.code ?? e.status ?? e.statusCode;
    return {
      error_nombre: err.name || "Error",
      error_codigo: codigo == null ? null : String(codigo).slice(0, 40),
      error_resumen: redactar(err.message ?? ""),
    };
  }
  if (typeof err === "string") return { error_nombre: "texto", error_codigo: null, error_resumen: redactar(err) };
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const codigo = o.code ?? o.status ?? o.statusCode;
    let texto = "";
    if (typeof o.message === "string") texto = o.message;
    else if (typeof o.error === "string") texto = o.error;
    else {
      try {
        texto = JSON.stringify(err) ?? "";
      } catch {
        texto = "";
      }
    }
    return {
      error_nombre: typeof o.name === "string" ? o.name : "objeto",
      error_codigo: codigo == null ? null : String(codigo).slice(0, 40),
      error_resumen: redactar(texto),
    };
  }
  return { error_nombre: typeof err, error_codigo: null, error_resumen: "" };
}

function limpiarDetalle(d: DetalleIncidencia | undefined): DetalleIncidencia {
  const salida: DetalleIncidencia = {};
  if (!d) return salida;
  let n = 0;
  for (const [k, v] of Object.entries(d)) {
    if (n >= CLAVES_DETALLE_MAX) break;
    if (v === undefined) continue;
    const clave = k.slice(0, 40);
    if (typeof v === "string") salida[clave] = redactar(v);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) salida[clave] = v;
    else continue;
    n++;
  }
  return salida;
}

function cuboDe(ahora: Date): Date {
  const h = new Date(ahora);
  h.setUTCMinutes(0, 0, 0);
  return h;
}

// ─── Registrar ───────────────────────────────────────────────────────────────

export async function registrarIncidencia(r: RegistroIncidencia): Promise<{ veces: number; sistematico: boolean } | null> {
  const cliente = r.cliente ?? currentCliente();
  const ahora = r.ahora ?? new Date();
  const detalle: DetalleIncidencia = {
    ...(r.error !== undefined ? resumirError(r.error) : {}),
    ...limpiarDetalle(r.detalle),
  };
  // La línea de consola lleva lo técnico ENTERO (es la consola de Vercel, no
  // la tabla); la tabla, lo redactado.
  const crudo =
    r.error instanceof Error ? r.error.message : typeof r.error === "string" ? r.error : r.error !== undefined ? detalle.error_resumen : "";
  console.error(
    `[incidencia] ${r.tipo}/${r.motivo} ${r.origen}${r.clinicaId ? ` clinica=${r.clinicaId}` : ""}${r.referencia ? ` ref=${r.referencia}` : ""}${r.soloLog ? ` ${r.soloLog}` : ""}${crudo ? `: ${String(crudo).slice(0, 600)}` : ""}`,
  );
  if (!cliente) return null; // sin contexto no hay fila RLS que escribir; la consola ya lo tiene

  try {
    const hora = cuboDe(ahora);
    const resultado = await runWithClienteDb(cliente, async (trx) => {
      const enHora = await sql<{ n: number }>`
        select count(*)::int as n from incidencias
         where cliente = ${cliente}::cliente_t and hora = ${hora}`.execute(trx);
      const saturado = Number(enHora.rows?.[0]?.n ?? 0) >= TOPE_FILAS_HORA;

      const fila = saturado
        ? { tipo: "sistema" as TipoIncidencia, motivo: "tope_incidencias", origen: "lib/incidencias", referencia: null, clinicaId: null, detalle: { tope: TOPE_FILAS_HORA } as DetalleIncidencia, reintentable: false }
        : { tipo: r.tipo, motivo: r.motivo, origen: r.origen, referencia: r.referencia ?? null, clinicaId: r.clinicaId ?? null, detalle, reintentable: r.reintentable ?? false };

      const up = await sql<{ veces: number }>`
        insert into incidencias (cliente, clinica_id, tipo, motivo, origen, referencia, detalle, reintentable, hora, primera_vez, ultima_vez)
        values (${cliente}::cliente_t, ${fila.clinicaId}, ${fila.tipo}, ${fila.motivo}, ${fila.origen}, ${fila.referencia},
                ${JSON.stringify(fila.detalle)}::jsonb, ${fila.reintentable}, ${hora}, ${ahora}, ${ahora})
        on conflict (cliente, (coalesce(clinica_id, '')), tipo, motivo, (coalesce(referencia, '')), hora)
        do update set veces = incidencias.veces + 1,
                      ultima_vez = greatest(incidencias.ultima_vez, excluded.ultima_vez),
                      detalle = excluded.detalle,
                      reintentable = excluded.reintentable
        returning veces`.execute(trx);
      const veces = Number(up.rows?.[0]?.veces ?? 1);
      if (saturado) return { veces, sistematico: false, nRefs: 0 };

      const refs = await sql<{ n: number }>`
        select count(distinct coalesce(referencia, ''))::int as n from incidencias
         where cliente = ${cliente}::cliente_t
           and coalesce(clinica_id, '') = ${fila.clinicaId ?? ""}
           and tipo = ${fila.tipo} and motivo = ${fila.motivo}
           and ultima_vez > ${ahora}::timestamptz - make_interval(mins => ${VENTANA_MIN})`.execute(trx);
      const nRefs = Number(refs.rows?.[0]?.n ?? 0);
      return { veces, sistematico: nRefs >= UMBRAL_SISTEMATICO, nRefs };
    });

    const avisar = r.avisar ?? "sistematico";
    if (avisar === "siempre" || (avisar === "sistematico" && resultado.sistematico)) {
      await avisarEnCampana({ cliente, clinicaId: r.clinicaId ?? null, tipo: r.tipo, nRefs: resultado.nRefs, aviso: r.aviso, ahora });
    }
    return { veces: resultado.veces, sistematico: resultado.sistematico };
  } catch (err) {
    console.error("[incidencias] no se pudo registrar:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function avisarEnCampana(args: {
  cliente: Cliente;
  clinicaId: string | null;
  tipo: TipoIncidencia;
  nRefs: number;
  aviso?: AvisoIncidencia;
  ahora: Date;
}): Promise<void> {
  const titulo = args.aviso?.titulo ?? TITULO_TIPO[args.tipo];
  const marca = `[${args.clinicaId ?? "global"}]`;
  try {
    const reciente = await runWithClienteDb(args.cliente, (trx) =>
      sql<{ ok: number }>`select 1 as ok from notificaciones
          where tipo = 'Sistema' and titulo = ${titulo}
            and coalesce(mensaje, '') like ${`%${marca}%`}
            and fecha_creacion > ${args.ahora}::timestamptz - make_interval(mins => ${VENTANA_MIN})
          limit 1`.execute(trx),
    );
    if (reciente.rows?.length) return;
    const { crearNotificacion } = await import("./presupuestos/notificaciones");
    const cuerpo = args.aviso?.mensaje ?? "Detalle y frecuencia en Ajustes › Incidencias.";
    const repetido = args.nRefs >= UMBRAL_SISTEMATICO ? ` (${args.nRefs} casos distintos en la última hora)` : "";
    await crearNotificacion({
      usuario: "todos",
      tipo: "Sistema",
      titulo,
      mensaje: `${marca} ${cuerpo}${repetido}`,
      link: args.aviso?.link ?? "/ajustes/incidencias",
    });
  } catch (err) {
    console.error("[incidencias] no se pudo avisar en la campana:", err instanceof Error ? err.message : err);
  }
}

// ─── Leer ────────────────────────────────────────────────────────────────────

export type GrupoIncidencias = {
  clinicaId: string | null;
  tipo: TipoIncidencia;
  motivo: string;
  origen: string;
  veces: number;
  referencias: number;
  refsUltimaHora: number;
  primeraVez: string;
  ultimaVez: string;
  reintentable: boolean;
  detalle: DetalleIncidencia | null;
  /** Las últimas referencias; el teléfono se resuelve AL LEER (bajo RLS), no se guarda. */
  ultimas: { referencia: string; telefono: string | null }[];
};

export async function listarIncidencias(opts?: { horas?: number; ahora?: Date; cliente?: Cliente }): Promise<GrupoIncidencias[]> {
  const cliente = opts?.cliente ?? currentCliente();
  if (!cliente) throw new Error("listarIncidencias: sin cliente");
  const horas = opts?.horas ?? 24;
  const ahora = opts?.ahora ?? new Date();
  return runWithClienteDb(cliente, async (trx) => {
    const r = await sql<{
      clinica_id: string | null;
      tipo: TipoIncidencia;
      motivo: string;
      origen: string;
      veces: number;
      referencias: number;
      refs_ultima_hora: number;
      primera_vez: Date;
      ultima_vez: Date;
      reintentable: boolean;
      detalle: unknown;
      ultimas_refs: string[] | null;
    }>`
      select i.clinica_id, i.tipo, i.motivo,
             (array_agg(i.origen order by i.ultima_vez desc))[1] as origen,
             sum(i.veces)::int as veces,
             count(distinct coalesce(i.referencia, ''))::int as referencias,
             (count(distinct coalesce(i.referencia, '')) filter (where i.ultima_vez > ${ahora}::timestamptz - make_interval(mins => ${VENTANA_MIN})))::int as refs_ultima_hora,
             min(i.primera_vez) as primera_vez,
             max(i.ultima_vez) as ultima_vez,
             bool_or(i.reintentable) as reintentable,
             (array_agg(i.detalle order by i.ultima_vez desc))[1] as detalle,
             (array_agg(i.referencia order by i.ultima_vez desc) filter (where i.referencia is not null))[1:5] as ultimas_refs
        from incidencias i
       where i.cliente = ${cliente}::cliente_t
         and i.ultima_vez > ${ahora}::timestamptz - make_interval(hours => ${horas})
       group by i.clinica_id, i.tipo, i.motivo
       order by refs_ultima_hora desc, ultima_vez desc`.execute(trx);
    const grupos = r.rows ?? [];
    const refs = [...new Set(grupos.flatMap((g) => g.ultimas_refs ?? []))];
    const telefonos = new Map<string, string>();
    if (refs.length) {
      const m = await sql<{ waba_message_id: string; telefono: string | null }>`
        select waba_message_id, telefono from mensajes_whatsapp
         where waba_message_id = any(${refs})`.execute(trx);
      for (const row of m.rows ?? []) if (row.telefono) telefonos.set(row.waba_message_id, row.telefono);
    }
    return grupos.map((g) => ({
      clinicaId: g.clinica_id,
      tipo: g.tipo,
      motivo: g.motivo,
      origen: g.origen,
      veces: Number(g.veces),
      referencias: Number(g.referencias),
      refsUltimaHora: Number(g.refs_ultima_hora),
      primeraVez: new Date(g.primera_vez).toISOString(),
      ultimaVez: new Date(g.ultima_vez).toISOString(),
      reintentable: Boolean(g.reintentable),
      detalle: g.detalle && typeof g.detalle === "object" ? (g.detalle as DetalleIncidencia) : null,
      ultimas: (g.ultimas_refs ?? []).map((ref) => ({ referencia: ref, telefono: telefonos.get(ref) ?? null })),
    }));
  });
}

// ─── Caducidad ───────────────────────────────────────────────────────────────

/** INCIDENCIAS_RETENCION_DIAS (90 por defecto), nunca por encima del plazo de
 *  conversaciones si el abogado lo ha fijado: una referencia a un mensaje no
 *  debe sobrevivir al mensaje. */
export function plazoRetencionIncidencias(): number {
  const raw = Number(process.env.INCIDENCIAS_RETENCION_DIAS ?? RETENCION_DIAS_DEFAULT);
  let plazo = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : RETENCION_DIAS_DEFAULT;
  const conv = Number(process.env.RETENCION_CONVERSACIONES_DIAS);
  if (Number.isFinite(conv) && conv > 0) plazo = Math.min(plazo, Math.floor(conv));
  return plazo;
}

export async function retencionIncidencias(opts: { dias: number; ahora?: Date; cliente?: Cliente }): Promise<{ borradas: number }> {
  const cliente = opts.cliente ?? currentCliente();
  if (!cliente) throw new Error("retencionIncidencias: sin cliente");
  if (!Number.isFinite(opts.dias) || opts.dias <= 0) throw new Error("retencionIncidencias: plazo inválido");
  const ahora = opts.ahora ?? new Date();
  return runWithClienteDb(cliente, async (trx) => {
    const r = await sql<{ n: number }>`with d as (
        delete from incidencias
         where cliente = ${cliente}::cliente_t
           and ultima_vez < ${ahora}::timestamptz - make_interval(days => ${opts.dias})
         returning 1) select count(*)::int as n from d`.execute(trx);
    return { borradas: Number(r.rows?.[0]?.n ?? 0) };
  });
}
