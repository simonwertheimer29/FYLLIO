// app/lib/agente/por-que.ts
//
// «VER POR QUÉ» POR MENSAJE — el inspector de decisiones (plan maestro 2.8,
// MEJORAS 183). La ficha del caso enseña el ÚLTIMO juicio; todo lo demás
// vivía en el log y nadie podía contestar «¿por qué el agente dijo esto?»
// sobre un mensaje concreto de hace tres días. Aquí se agrupa por TURNO lo
// que el agente dejó persistido (evento `evaluacion` + los `aplazado`,
// `derivado`, `espera_*` del mismo mensaje) y se enlaza con el mensaje que
// ve la coordinadora: el entrante que lo provocó y, si lo hubo, el saliente
// que redactó.
//
// Reglas:
//   · Solo lo PERSISTIDO. Nada se recalcula con modelo (fase 2: inteligencia
//     visible sin gastar modelo). La cola sí se deriva del hecho, como en
//     todas partes (colaDeDerivacion).
//   · El enlace evento→mensaje es `mensaje_id = waba_message_id ?? id` (la
//     semántica del barrido y de las métricas por sede, 8-sep).
//   · El saliente «del agente» de un turno es el primer saliente redactado
//     por él (sugerido_por_ia) tras la evaluación y ANTES del siguiente
//     entrante. Si no lo hay (descartado, derivado sin respuesta, no legible),
//     el turno se ancla al entrante: ahí es donde se pregunta «¿y por qué no
//     contestó?».
//   · El orden de lo recogido se declara (por nombre): jsonb no conserva el
//     del modelo (§23).
//   · Sin acceso aquí: la RUTA aplica el mismo aislamiento que la ficha.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { leerPayloadEvaluacion } from "./persistir-turno";
import { colaDeDerivacion, type CausaDerivacion } from "../automatizacion/estado";
import { costeUsdDeTurno } from "./coste";
import { contextoDeConversacion } from "./contexto-conversacion";
import { esLegible } from "../mensajeria/tipos-mensaje";
import type { EscenarioPrueba, TurnoPrueba } from "./banco-pruebas";
import type { EstadoSesionPrueba } from "./sesion-prueba";
import type { ClaveAplazado, EventoAplazamiento } from "../automatizacion/aplazamientos";
import { optOutDeTelefono } from "../contacto/optout";
import type { VersionTurno } from "./version";
import type { SenalesHilo } from "./evaluador";
import type { CandidatoMarcado } from "./candidatos-eval.tipos";

export type TurnoExplicado = {
  /** `mensaje_id` de los eventos del turno (waba_message_id ?? id del entrante). */
  clave: string;
  /** Fila del entrante que lo provocó; null si el mensaje no está en el hilo. */
  entranteId: string | null;
  /** Fila del saliente que redactó el agente en este turno, si lo hubo. */
  salienteId: string | null;
  /** Cuándo juzgó (ISO del primer evento del turno). */
  en: string;
  /** 034 — entregó SIN juicio (mensaje no legible). */
  sinJuicio: boolean;
  juicio: {
    tema: string;
    peticionOQueja: boolean;
    malestar: boolean;
    urgenciaMedica: boolean;
    mencionaAntecedenteMedico: boolean;
    vuelveSobreAplazado: string | null;
    idioma: string | null;
    pideNoContacto: boolean;
    hiloTruncado: boolean;
  } | null;
  /** Lo recogido en ESTE turno, por objetivo, solo con valor. */
  recogidos: Array<{ objetivo: string; campos: Array<{ clave: string; valor: string }> }>;
  aplazados: Array<{ clave: string; motivo: string | null }>;
  entrega: { causa: string; cola: "prioritaria" | "normal"; motivo: string | null } | null;
  espera: { fijadaHasta: string | null; levantada: string | null };
  descarte: { motivo: string; frase: string | null } | null;
  /** 12-09 — el juez infringió, se quitó SU frase y el resto SÍ se envió.
   *  No es un descarte: el mensaje salió. */
  poda: { motivo: string; frase: string } | null;
  etiquetasDescartadas: string[];
  /** El borrador que propuso (payload `respuesta`). */
  borrador: string | null;
  /** 2.7 (MEJORAS 182) — si una persona marcó el turno como error. Lo rellena
   *  la ruta (`anotarCorrecciones`), no este módulo: aquí solo el log del agente. */
  correccion?: CandidatoMarcado | null;
  tecnico: {
    version: VersionTurno | null;
    /** Hilos jugados (10-09): el turno lo sembró el seed de la demo, no lo
     *  juzgó el agente. Sale del payload (`sembrado: true`), no del tenant. */
    sembrado: boolean;
    modelo: string | null;
    latenciaMs: number | null;
    costeUsd: number | null;
    senales: SenalesHilo | null;
    /** MEJORAS 169 — lo que vio el modelo. null en turnos anteriores. */
    entrada: string | null;
  };
};

type FilaMensaje = {
  id: string;
  waba: string | null;
  direccion: "Entrante" | "Saliente";
  ts: string;
  sugerido: boolean;
  contenido: string;
  tipo: string | null;
  pendiente: boolean;
};

type FilaEvento = {
  evento: string;
  clave_aplazado: string | null;
  causa_derivacion: string | null;
  malestar: boolean | null;
  motivo_texto: string | null;
  hasta: string | null;
  evaluacion_json: unknown;
  created_at: string;
  mensaje_id: string;
};

async function leerHilo(telefono: string): Promise<{ mensajes: FilaMensaje[]; eventos: FilaEvento[] }> {
  const cliente = requireCliente("porQueDeHilo");
  return runWithClienteDb(cliente, async (trx) => {
    const m = await sql<{
      id: string; waba_message_id: string | null; direccion: string; timestamp: Date; sugerido_por_ia: boolean | null;
      contenido: string | null; tipo: string | null; fuente: string | null;
    }>`
      select id, waba_message_id, direccion, "timestamp", sugerido_por_ia, contenido, tipo, fuente
        from mensajes_whatsapp
       where telefono = ${telefono} and "timestamp" is not null
       order by "timestamp" asc, id asc`.execute(trx);
    // `hasta` es date y viaja como TEXTO: pg la devolvería como medianoche
    // LOCAL y toISOString() la convierte en el día anterior (qa:por-que).
    const e = await sql<{
      evento: string; clave_aplazado: string | null; causa_derivacion: string | null; malestar: boolean | null;
      motivo_texto: string | null; hasta: string | null; evaluacion_json: unknown; created_at: Date; mensaje_id: string;
    }>`
      select evento, clave_aplazado, causa_derivacion, malestar, motivo_texto, hasta::text as hasta, evaluacion_json, created_at, mensaje_id
        from eventos_automatizacion
       where tipo_caso = 'conversacion' and caso_id = ${telefono} and mensaje_id is not null
         and evento in ('evaluacion', 'aplazado', 'derivado', 'espera_fijada', 'espera_levantada')
       order by created_at asc, id asc`.execute(trx);
    return {
      mensajes: m.rows.map((r) => ({
        id: String(r.id),
        waba: r.waba_message_id ? String(r.waba_message_id) : null,
        direccion: r.direccion === "Entrante" ? "Entrante" : "Saliente",
        ts: new Date(r.timestamp).toISOString(),
        sugerido: r.sugerido_por_ia === true,
        contenido: String(r.contenido ?? ""),
        tipo: r.tipo ? String(r.tipo) : null,
        pendiente: r.fuente === "Modo_A_manual_pendiente",
      })),
      eventos: e.rows.map((r) => ({
        evento: String(r.evento),
        clave_aplazado: r.clave_aplazado,
        causa_derivacion: r.causa_derivacion,
        malestar: r.malestar,
        motivo_texto: r.motivo_texto,
        hasta: r.hasta == null ? null : String(r.hasta).slice(0, 10),
        evaluacion_json: r.evaluacion_json,
        created_at: new Date(r.created_at).toISOString(),
        mensaje_id: String(r.mensaje_id),
      })),
    };
  });
}

const esMensajeDe = (m: FilaMensaje, clave: string) => m.waba === clave || m.id === clave;

/** El saliente redactado por el agente en el turno: el primero con
 *  sugerido_por_ia tras `desde` y antes del siguiente entrante. */
function salienteDelTurno(mensajes: FilaMensaje[], desdeIdx: number, desdeISO: string): string | null {
  for (let i = Math.max(0, desdeIdx); i < mensajes.length; i++) {
    const m = mensajes[i]!;
    if (m.ts < desdeISO) continue;
    if (m.direccion === "Entrante" && i > desdeIdx) return null;
    if (m.direccion === "Saliente" && m.sugerido) return m.id;
  }
  return null;
}

function texto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Los turnos del hilo, en orden, cada uno con lo que el agente dejó escrito. */
export async function porQueDeHilo(telefono: string): Promise<TurnoExplicado[]> {
  const { mensajes, eventos } = await leerHilo(telefono);
  const porClave = new Map<string, FilaEvento[]>();
  for (const e of eventos) {
    const lista = porClave.get(e.mensaje_id);
    if (lista) lista.push(e);
    else porClave.set(e.mensaje_id, [e]);
  }

  const turnos: TurnoExplicado[] = [];
  for (const [clave, evs] of porClave) {
    const en = evs[0]!.created_at;
    const evaluacion = evs.find((e) => e.evento === "evaluacion") ?? null;
    const payload = evaluacion ? leerPayloadEvaluacion(evaluacion.evaluacion_json) : null;
    const derivado = evs.find((e) => e.evento === "derivado") ?? null;
    const entranteIdx = mensajes.findIndex((m) => esMensajeDe(m, clave));
    const entrante = entranteIdx >= 0 ? mensajes[entranteIdx]! : null;
    const salienteId = payload ? salienteDelTurno(mensajes, entranteIdx >= 0 ? entranteIdx + 1 : 0, en) : null;

    const recogidos: TurnoExplicado["recogidos"] = [];
    const campos = (payload?.camposRecogidos ?? {}) as Record<string, Record<string, unknown> | undefined>;
    for (const objetivo of Object.keys(campos).sort()) {
      const c = campos[objetivo] ?? {};
      const conValor = Object.keys(c)
        .sort()
        .filter((k) => c[k] != null && c[k] !== "no_aplica" && texto(c[k]).trim() !== "")
        .map((k) => ({ clave: k, valor: texto(c[k]) }));
      if (conValor.length) recogidos.push({ objetivo, campos: conValor });
    }

    const causa = derivado?.causa_derivacion ?? null;
    turnos.push({
      clave,
      entranteId: entrante?.id ?? null,
      salienteId,
      en,
      sinJuicio: !payload && derivado != null,
      juicio: payload
        ? {
            tema: payload.tema,
            peticionOQueja: payload.peticionOQueja === true,
            malestar: payload.malestar === true,
            urgenciaMedica: payload.urgenciaMedica === true,
            mencionaAntecedenteMedico: payload.mencionaAntecedenteMedico === true,
            vuelveSobreAplazado: payload.vuelveSobreAplazado ?? null,
            idioma: payload.idioma ?? null,
            pideNoContacto: payload.pideNoContacto === true,
            hiloTruncado: payload.hiloTruncado === true,
          }
        : null,
      recogidos,
      aplazados: evs
        .filter((e) => e.evento === "aplazado" && e.clave_aplazado)
        .map((e) => ({ clave: String(e.clave_aplazado), motivo: e.motivo_texto })),
      entrega: causa
        ? { causa, cola: colaDeDerivacion(causa as CausaDerivacion, derivado?.malestar ?? null), motivo: derivado?.motivo_texto ?? null }
        : null,
      espera: {
        fijadaHasta: evs.find((e) => e.evento === "espera_fijada")?.hasta ?? null,
        levantada: evs.find((e) => e.evento === "espera_levantada")?.motivo_texto ?? null,
      },
      descarte: payload?.borradorDescartado
        ? { motivo: String(payload.borradorDescartado.motivo), frase: payload.borradorDescartado.frase ?? null }
        : null,
      poda: payload?.borradorPodado
        ? { motivo: String(payload.borradorPodado.motivo), frase: String(payload.borradorPodado.frase) }
        : null,
      etiquetasDescartadas: payload?.etiquetasDescartadas ?? [],
      borrador: payload?.respuesta?.trim() ? payload.respuesta : null,
      tecnico: {
        version: payload?.version ?? null,
        sembrado: payload?.sembrado === true,
        modelo: payload?.modelo ?? null,
        latenciaMs: typeof payload?.latenciaMs === "number" ? payload.latenciaMs : null,
        costeUsd: payload ? costeUsdDeTurno(payload.usage, payload.modelo) : null,
        senales: payload?.senales ?? null,
        entrada: payload?.entrada ?? null,
      },
    });
  }
  turnos.sort((a, b) => (a.en < b.en ? -1 : a.en > b.en ? 1 : 0));
  return turnos;
}

// ─── Replay en el banco ──────────────────────────────────────────────────────

export type ReplayDeHilo = {
  clinicaId: string | null;
  escenario: EscenarioPrueba;
  /** El hilo REAL hasta el mensaje (excluido), solo texto y salientes confirmados. */
  hilo: TurnoPrueba[];
  /** El entrante que provocó el turno: el banco lo deja escrito para pulsar Enviar. */
  mensaje: string;
  /** Lo que producción había persistido ANTES de ese mensaje (aplazados,
   *  espera, derivado) y el opt-out vigente de hoy — la sesión del banco
   *  (11-09). Sin esto el replay volvía a probar el turno con la memoria
   *  vacía: sin aplazados, la insistencia no se reproducía. */
  sesion: EstadoSesionPrueba;
};

const TOPE_HILO_REPLAY = 40;

/** Reconstruye la sesión del banco para reproducir un turno real con la
 *  configuración VIGENTE. La situación (presupuesto, deuda) es la de HOY —
 *  el contexto no tiene histórico y no se inventa el de aquel día; la
 *  pantalla lo dice. null = el mensaje no está en el hilo. */
export async function replayDeHilo(telefono: string, hasta: string): Promise<ReplayDeHilo | null> {
  const { mensajes, eventos } = await leerHilo(telefono);
  const idx = mensajes.findIndex((m) => esMensajeDe(m, hasta));
  if (idx < 0) return null;
  const objetivo = mensajes[idx]!;
  if (objetivo.direccion !== "Entrante") return null;
  const previos = mensajes
    .slice(0, idx)
    .filter((m) => !m.pendiente && (m.tipo == null || esLegible(m.tipo)) && m.contenido.trim() !== "");
  const hilo: TurnoPrueba[] = previos.slice(-TOPE_HILO_REPLAY).map((m) => ({ direccion: m.direccion, contenido: m.contenido }));
  const derivadoPrevio = eventos.some((e) => e.evento === "derivado" && e.created_at < objetivo.ts);
  // 11-09 — el log que producción leyó antes de ese turno (evaluar-entrante
  // §3 y semaforo.ts), SIN el filtro de mensaje_id de leerHilo: un
  // `aplazado_resuelto` lo emite una persona desde la ficha, sin mensaje.
  const cliente = requireCliente("replayDeHilo");
  const log = await runWithClienteDb(cliente, (trx) =>
    sql<{ evento: string; clave_aplazado: string | null; motivo_texto: string | null; hasta: string | null; created_at: Date }>`
      select evento, clave_aplazado, motivo_texto, hasta::text as hasta, created_at
        from eventos_automatizacion
       where tipo_caso = 'conversacion' and caso_id = ${telefono}
         and evento in ('aplazado', 'aplazado_resuelto', 'espera_fijada', 'espera_levantada')
         and created_at < ${objetivo.ts}::timestamptz
       order by created_at asc, id asc`.execute(trx),
  );
  const filas = log.rows.map((r) => ({ ...r, createdAt: new Date(r.created_at).toISOString() }));
  const aplazamientos: EventoAplazamiento[] = filas
    .filter((r) => (r.evento === "aplazado" || r.evento === "aplazado_resuelto") && r.clave_aplazado)
    .map((r) => ({
      evento: r.evento as "aplazado" | "aplazado_resuelto",
      clave: r.clave_aplazado as ClaveAplazado,
      motivoTexto: r.motivo_texto,
      createdAt: r.createdAt,
    }));
  const esperas = filas.filter((r) => r.evento === "espera_fijada" && r.hasta);
  const ultimaEspera = esperas[esperas.length - 1] ?? null;
  const espera =
    ultimaEspera && !filas.some((r) => r.evento === "espera_levantada" && r.createdAt > ultimaEspera.createdAt)
      ? { hasta: String(ultimaEspera.hasta).slice(0, 10), motivo: ultimaEspera.motivo_texto }
      : null;
  // El opt-out, como el contexto: la situación es la de HOY.
  const optOut = (await optOutDeTelefono(telefono)).activo;

  const ctx = await contextoDeConversacion(telefono);
  const vivo = ctx.presupuestosVivos[0] ?? null;
  const nombre = ctx.origenNombre === "paciente" || ctx.origenNombre === "lead" ? ctx.nombre : undefined;
  const escenario: EscenarioPrueba = vivo
    ? { tipo: "presupuesto", nombre, tratamiento: vivo.tratamiento ?? undefined, importe: vivo.importe ?? undefined }
    : ctx.pendienteCobro > 0
      ? { tipo: "cobro", nombre, deuda: ctx.pendienteCobro }
      : ctx.pacienteId
        ? { tipo: "al_dia", nombre }
        : { tipo: "lead_nuevo", nombre };
  return {
    clinicaId: ctx.clinicaId,
    escenario,
    hilo,
    mensaje: objetivo.contenido,
    sesion: { aplazamientos, espera, optOut, derivado: derivadoPrevio },
  };
}
