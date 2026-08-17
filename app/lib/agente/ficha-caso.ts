// app/lib/agente/ficha-caso.ts
//
// LA FICHA DEL CASO (fase B, aprobada 2026-08-17): lo que ve la coordinadora
// al abrir un caso entregado por el agente, para actuar sin releer el hilo
// ni repreguntar lo ya recogido.
//
// UNA SOLA FICHA: esta función es la única fuente — Seguimiento la despliega
// y Mensajería la monta en su columna derecha. NADA de aquí se persiste:
// todo se deriva al leer, de fuentes que ya existen (semáforo, log de
// eventos, mensajes, historial). Si dos pantallas enseñaran cosas distintas
// del mismo caso, sería un bug de esta función, no de las pantallas.
//
// REGLA DE DISEÑO (dictada): la ficha es corta. Cada campo nuevo le quita
// fuerza al primero — si algo no cambia lo que la coordinadora hará en el
// próximo minuto, no entra.
//
// HONESTIDAD (caso a): un hilo SIN evaluación del agente lo dice con todas
// las letras (`evaluado: false`, `queQuiere: null`) — ni blanco ni resumen
// fingido. La frase de «qué quiere» la compone CÓDIGO desde los campos
// recogidos, nunca un resumen generado que habría que verificar.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { contextoDeConversacion } from "./contexto-conversacion";
import { semaforoDeContacto, type EstadoSemaforo } from "../automatizacion/semaforo";
import {
  pendientesDeAplazados,
  ETIQUETA_CLAVE,
  type ClaveAplazado,
  type EventoAplazamiento,
} from "../automatizacion/aplazamientos";
import type { EtapaObjetivo } from "../automatizacion/objetivos";
import type { PayloadEvaluacion } from "./persistir-turno";

export type FichaCaso = {
  telefono: string;
  nombre: string;
  esPaciente: boolean;
  /** false = el agente NO ha evaluado este hilo (caso a): la ficha lo dice,
   *  no lo rellena. */
  evaluado: boolean;

  // ── Arriba del todo, antes de nada ──
  /** Lo único de la ficha que dice qué NO hacer: si hay espera vigente,
   *  escribir rompe la promesa que hizo el agente. */
  espera: { hasta: string; frase: string | null } | null;
  /** Qué se ha intentado ya: evita insistir a quien ya se escribió tres
   *  veces esta semana. Contado de mensajes, no juzgado. */
  intentos: { salientes: number; ultimo: string | null };

  // ── Estado del caso ──
  semaforo: EstadoSemaforo;
  /** Caso c: el PACIENTE cerró desde el portal (historial portal_*) — se
   *  distingue de «lo entregó el agente» (derivado en el log). */
  cierrePorPaciente: { accion: "aceptado" | "rechazado"; fecha: string } | null;

  // ── 1 · Qué quiere (una frase, compuesta por código) ──
  queQuiere: string | null;
  objetivoActivo: EtapaObjetivo | null;
  /** Caso b: los demás objetivos abiertos, UNA línea cada uno. */
  otrosObjetivos: EtapaObjetivo[];

  // ── 2 · Qué falta resolver (vacío si no hay: no inventar relleno) ──
  pendientes: { clave: ClaveAplazado; etiqueta: string; frase: string }[];

  // ── 3 · Qué recogió el agente ──
  recogido: { campo: string; valor: string | null }[] | null;

  // ── La línea de la cola (Seguimiento): paciente · qué quiere · espera ──
  linea: { paciente: string; queQuiere: string; esperandoDesde: string | null };
};

const ETIQUETA_OBJETIVO: Record<EtapaObjetivo, string> = {
  cita: "Quiere cita",
  presupuesto: "Decidir su presupuesto",
  cobro: "Su pago pendiente",
  identificar: "Contacto nuevo",
};

/** La frase de «qué quiere», determinista: etiqueta del objetivo + los
 *  valores reales recogidos. Sin modelo — no hay nada que verificar. */
function componerQueQuiere(
  objetivo: EtapaObjetivo,
  campos: Record<string, string | null> | undefined,
): string {
  const valores = Object.values(campos ?? {})
    .filter((v): v is string => v != null && v.trim() !== "" && v !== "no_aplica")
    .map((v) => v.trim());
  return valores.length ? `${ETIQUETA_OBJETIVO[objetivo]} — ${valores.join(" · ")}` : ETIQUETA_OBJETIVO[objetivo];
}

export async function fichaDeCaso(telefono: string, opts?: { hoy?: string }): Promise<FichaCaso> {
  const cliente = requireCliente("fichaDeCaso");
  const ctx = await contextoDeConversacion(telefono);
  const sem = await semaforoDeContacto(telefono, { hoy: opts?.hoy });

  const datos = await runWithClienteDb(cliente, async (trx) => {
    // Intentos: salientes contados del hilo, y el último de cada dirección.
    const m: any = await sql`select
        count(*) filter (where direccion = 'Saliente')::int as salientes,
        max("timestamp") filter (where direccion = 'Saliente') as ultimo_saliente,
        max("timestamp") filter (where direccion = 'Entrante') as ultimo_entrante
      from mensajes_whatsapp where telefono = ${telefono}`.execute(trx);

    const eventos = await trx
      .selectFrom("eventos_automatizacion")
      .select(["evento", "clave_aplazado", "motivo_texto", "evaluacion_json", "created_at"])
      .where("tipo_caso", "=", "conversacion")
      .where("caso_id", "=", telefono)
      .where("evento", "in", ["aplazado", "aplazado_resuelto", "evaluacion"])
      .orderBy("created_at", "asc")
      .execute();

    // Caso c: la firma del portal vive en historial_acciones, atada a los
    // presupuestos de la persona (por id o por teléfono del presupuesto).
    const digitos = telefono.replace(/[^0-9]/g, "");
    const portal: any = await sql`select ha.tipo, ha.fecha
        from historial_acciones ha
        join presupuestos pr on pr.id = ha.presupuesto_id
        where ha.tipo in ('portal_aceptado', 'portal_rechazado')
          and (replace(replace(replace(coalesce(pr.paciente_telefono,''), ' ', ''), '+', ''), '-', '') like ${"%" + digitos + "%"}
               ${ctx.pacienteId ? sql`or pr.paciente_id = ${ctx.pacienteId}` : sql``})
        order by ha.fecha desc limit 1`.execute(trx);

    return {
      salientes: Number(m.rows?.[0]?.salientes ?? 0),
      ultimoSaliente: m.rows?.[0]?.ultimo_saliente ?? null,
      ultimoEntrante: m.rows?.[0]?.ultimo_entrante ?? null,
      eventos,
      portal: portal.rows?.[0] ?? null,
    };
  });

  // Pendientes: la regla del posterior, la misma que usa el evaluador.
  const evsAplazamiento: EventoAplazamiento[] = datos.eventos
    .filter((x) => x.evento === "aplazado" || x.evento === "aplazado_resuelto")
    .map((x) => ({
      evento: x.evento as "aplazado" | "aplazado_resuelto",
      clave: x.clave_aplazado as ClaveAplazado,
      motivoTexto: x.motivo_texto,
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
    }));
  const pendientes = pendientesDeAplazados(evsAplazamiento).flatMap((p) =>
    p.motivos.map((frase) => ({ clave: p.clave, etiqueta: ETIQUETA_CLAVE[p.clave], frase })),
  );

  // El último juicio persistido — la verdad de «qué recogió».
  const filasEvaluacion = datos.eventos.filter((x) => x.evento === "evaluacion");
  const ultimaEvaluacion = filasEvaluacion[filasEvaluacion.length - 1] ?? null;
  const payload: PayloadEvaluacion | null = ultimaEvaluacion?.evaluacion_json
    ? (JSON.parse(ultimaEvaluacion.evaluacion_json) as PayloadEvaluacion)
    : null;
  const evaluado = payload != null;

  // Objetivo activo: la MISMA regla que el evaluador (tema si está abierto;
  // si no, el de mayor precedencia). Con lo abierto de HOY, no lo del turno.
  const abiertos = ctx.objetivosAbiertos;
  const objetivoActivo: EtapaObjetivo | null =
    payload && (abiertos as string[]).includes(payload.tema)
      ? (payload.tema as EtapaObjetivo)
      : (abiertos[0] ?? null);
  const otrosObjetivos = abiertos.filter((o) => o !== objetivoActivo);

  const camposActivo = objetivoActivo ? (payload?.camposRecogidos as any)?.[objetivoActivo] : undefined;
  const queQuiere = evaluado && objetivoActivo ? componerQueQuiere(objetivoActivo, camposActivo) : null;
  const recogido = evaluado && camposActivo
    ? Object.entries(camposActivo as Record<string, string | null>).map(([campo, valor]) => ({ campo, valor }))
    : evaluado
      ? []
      : null;

  // «Cuánto lleva esperando» de la línea: desde la entrega si el caso está
  // en manos de alguien; si no, desde el último entrante sin responder.
  const ultEntrante = datos.ultimoEntrante ? new Date(datos.ultimoEntrante).toISOString() : null;
  const ultSaliente = datos.ultimoSaliente ? new Date(datos.ultimoSaliente).toISOString() : null;
  const esperandoDesde =
    !sem.verde && sem.motivo === "derivado_sin_resolver" && sem.desde
      ? sem.desde
      : ultEntrante && (!ultSaliente || ultEntrante > ultSaliente)
        ? ultEntrante
        : null;

  return {
    telefono,
    nombre: ctx.nombre,
    esPaciente: ctx.pacienteId != null,
    evaluado,
    espera:
      !sem.verde && sem.motivo === "espera" && sem.hasta
        ? { hasta: sem.hasta, frase: sem.esperaMotivo ?? null }
        : null,
    intentos: { salientes: datos.salientes, ultimo: ultSaliente },
    semaforo: sem,
    cierrePorPaciente: datos.portal
      ? {
          accion: datos.portal.tipo === "portal_aceptado" ? "aceptado" : "rechazado",
          fecha: new Date(datos.portal.fecha).toISOString(),
        }
      : null,
    queQuiere,
    objetivoActivo,
    otrosObjetivos,
    pendientes,
    recogido,
    linea: {
      paciente: ctx.nombre,
      queQuiere: queQuiere ?? (evaluado ? "(sin objetivo abierto)" : "Sin evaluar por el agente"),
      esperandoDesde,
    },
  };
}
