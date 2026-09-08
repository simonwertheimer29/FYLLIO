// app/lib/agente/candidatos-eval.ts
//
// «EL AGENTE SE EQUIVOCÓ AQUÍ» (plan maestro 2.7, MEJORAS 182). Una persona,
// desde el panel «por qué» de Mensajería, marca un turno del agente como
// error y dice qué falló y qué debería haber hecho. Eso se guarda como CASO
// CANDIDATO de la vara (evals/), con revisión humana antes de entrar.
//
// Reglas:
//   · El cliente NO manda lo que hizo el agente: manda (teléfono, turno,
//     fallo, corrección) y el servidor copia lo PERSISTIDO del turno —el
//     mismo `porQueDeHilo` que pinta el panel (§21: lo que la persona vio).
//   · Un candidato por turno (unique cliente+mensaje_id): volver a marcar
//     corrige y reabre la revisión, no duplica (§2).
//   · Todo éxito se confirma con la fila devuelta (§1).
//   · Acceso: la RUTA aplica la regla del hilo. Aquí solo RLS.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { porQueDeHilo, type TurnoExplicado } from "./por-que";
import { clinicasDelHilo } from "../mensajeria/acceso-hilo";
import {
  motivoCorreccionInvalida,
  type CandidatoMarcado,
  type DecisionAgente,
  type EstadoCandidato,
  type FalloCandidato,
} from "./candidatos-eval.tipos";

// Lo puro (vocabulario, etiquetas, validación) se importa de `candidatos-eval.tipos`
// directamente: un `export *` compilado a CJS no expone los nombres a los
// scripts .mts (cjs-module-lexer no los ve) y el import falla en tiempo de carga.

export class CandidatoInvalidoError extends Error {
  readonly status = 400;
}
export class TurnoNoEncontradoError extends Error {
  readonly status = 404;
  constructor() {
    super("Ese mensaje del agente no está en la conversación");
  }
}

type FilaMarcado = {
  id: string;
  fallo: FalloCandidato;
  correccion: string | null;
  marcado_por_nombre: string | null;
  marcado_en: Date;
  estado: EstadoCandidato;
};

const aMarcado = (r: FilaMarcado): CandidatoMarcado => ({
  id: String(r.id),
  fallo: r.fallo,
  correccion: r.correccion,
  porNombre: r.marcado_por_nombre,
  en: new Date(r.marcado_en).toISOString(),
  estado: r.estado,
});

/** Marca (o vuelve a marcar) un turno como error del agente. */
export async function marcarCandidato(args: {
  telefono: string;
  clave: string;
  fallo: unknown;
  correccion: unknown;
  por: { id: string; nombre: string | null };
}): Promise<CandidatoMarcado> {
  const motivo = motivoCorreccionInvalida(args.fallo, args.correccion);
  if (motivo) throw new CandidatoInvalidoError(motivo);
  const fallo = args.fallo as FalloCandidato;
  const correccion = typeof args.correccion === "string" && args.correccion.trim() ? args.correccion.trim() : null;

  const cliente = requireCliente("marcarCandidato");
  const turno = (await porQueDeHilo(args.telefono)).find((t) => t.clave === args.clave);
  if (!turno) throw new TurnoNoEncontradoError();
  const { ultima: clinicaId } = await clinicasDelHilo(args.telefono);

  // Lo que la persona vio, sin la entrada (va en su columna): el turno
  // explicado, no el payload crudo — es lo que juzgó.
  const { tecnico } = turno;
  const juicio = {
    clave: turno.clave,
    entranteId: turno.entranteId,
    salienteId: turno.salienteId,
    en: turno.en,
    sinJuicio: turno.sinJuicio,
    juicio: turno.juicio,
    recogidos: turno.recogidos,
    aplazados: turno.aplazados,
    entrega: turno.entrega,
    espera: turno.espera,
    descarte: turno.descarte,
    etiquetasDescartadas: turno.etiquetasDescartadas,
    borrador: turno.borrador,
    tecnico: { ...tecnico, entrada: undefined },
  };
  const decision: DecisionAgente = turno.entrega ? "entrego" : "siguio";

  return runWithClienteDb(cliente, async (trx) => {
    const paciente = turno.entranteId
      ? await sql<{ contenido: string | null }>`select contenido from mensajes_whatsapp where id = ${turno.entranteId} limit 1`.execute(trx)
      : null;
    const mensajePaciente = paciente?.rows[0]?.contenido ?? null;
    const r = await sql<FilaMarcado>`
      insert into casos_candidatos_eval
        (cliente, clinica_id, origen, telefono, mensaje_id, mensaje_paciente, entrada, juicio, borrador,
         decision_agente, causa_entrega, version, fallo, correccion, marcado_por, marcado_por_nombre)
      values
        (${cliente}, ${clinicaId}, 'real', ${args.telefono}, ${turno.clave}, ${mensajePaciente}, ${tecnico.entrada},
         ${JSON.stringify(juicio)}::jsonb, ${turno.borrador}, ${decision}, ${turno.entrega?.causa ?? null},
         ${tecnico.version ? JSON.stringify(tecnico.version) : null}::jsonb, ${fallo}, ${correccion},
         ${args.por.id}, ${args.por.nombre})
      on conflict (cliente, mensaje_id) do update set
        fallo = excluded.fallo, correccion = excluded.correccion,
        marcado_por = excluded.marcado_por, marcado_por_nombre = excluded.marcado_por_nombre, marcado_en = now(),
        mensaje_paciente = excluded.mensaje_paciente, entrada = excluded.entrada, juicio = excluded.juicio,
        borrador = excluded.borrador, decision_agente = excluded.decision_agente, causa_entrega = excluded.causa_entrega,
        version = excluded.version,
        -- Volver a marcar reabre la revisión: lo aceptado se decidió sobre otra corrección.
        estado = 'pendiente', revisado_en = null, nota_revision = null
      returning id, fallo, correccion, marcado_por_nombre, marcado_en, estado`.execute(trx);
    const fila = r.rows[0];
    if (!fila) throw new Error("marcarCandidato: la escritura no devolvió fila");
    return aMarcado(fila);
  });
}

/** Los turnos ya marcados de un hilo, por `mensaje_id`. */
export async function correccionesDeHilo(telefono: string): Promise<Record<string, CandidatoMarcado>> {
  const cliente = requireCliente("correccionesDeHilo");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<FilaMarcado & { mensaje_id: string }>`
      select id, mensaje_id, fallo, correccion, marcado_por_nombre, marcado_en, estado
        from casos_candidatos_eval
       where telefono = ${telefono}`.execute(trx),
  );
  const out: Record<string, CandidatoMarcado> = {};
  for (const f of r.rows) out[String(f.mensaje_id)] = aMarcado(f);
  return out;
}

/** Los turnos explicados con su corrección, si la hay. */
export async function anotarCorrecciones(telefono: string, turnos: TurnoExplicado[]): Promise<TurnoExplicado[]> {
  const marcados = await correccionesDeHilo(telefono);
  return turnos.map((t) => ({ ...t, correccion: marcados[t.clave] ?? null }));
}

// ─── Revisión (scripts/evals-candidatos.mts) ─────────────────────────────────

export type CandidatoCompleto = CandidatoMarcado & {
  clinicaId: string | null;
  origen: "real" | "banco";
  telefono: string;
  mensajeId: string;
  mensajePaciente: string | null;
  entrada: string | null;
  juicio: unknown;
  borrador: string | null;
  decision: DecisionAgente;
  causaEntrega: string | null;
  version: unknown;
  revisadoEn: string | null;
  notaRevision: string | null;
};

export async function listarCandidatos(opts: { estado: EstadoCandidato | "todos" }): Promise<CandidatoCompleto[]> {
  const cliente = requireCliente("listarCandidatos");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<FilaMarcado & {
      clinica_id: string | null; origen: "real" | "banco"; telefono: string; mensaje_id: string; mensaje_paciente: string | null;
      entrada: string | null; juicio: unknown; borrador: string | null; decision_agente: DecisionAgente; causa_entrega: string | null;
      version: unknown; revisado_en: Date | null; nota_revision: string | null;
    }>`
      select id, clinica_id, origen, telefono, mensaje_id, mensaje_paciente, entrada, juicio, borrador, decision_agente,
             causa_entrega, version, fallo, correccion, marcado_por_nombre, marcado_en, estado, revisado_en, nota_revision
        from casos_candidatos_eval
       where ${opts.estado === "todos" ? sql`true` : sql`estado = ${opts.estado}`}
       order by marcado_en desc`.execute(trx),
  );
  return r.rows.map((f) => ({
    ...aMarcado(f),
    clinicaId: f.clinica_id,
    origen: f.origen,
    telefono: String(f.telefono),
    mensajeId: String(f.mensaje_id),
    mensajePaciente: f.mensaje_paciente,
    entrada: f.entrada,
    juicio: f.juicio,
    borrador: f.borrador,
    decision: f.decision_agente,
    causaEntrega: f.causa_entrega,
    version: f.version,
    revisadoEn: f.revisado_en ? new Date(f.revisado_en).toISOString() : null,
    notaRevision: f.nota_revision,
  }));
}

/** Acepta o descarta un candidato. Cero filas = error (§1): el id no es de este cliente o no existe. */
export async function revisarCandidato(id: string, estado: "aceptado" | "descartado", nota: string | null): Promise<void> {
  const cliente = requireCliente("revisarCandidato");
  await runWithClienteDb(cliente, async (trx) => {
    const r = await sql<{ id: string }>`
      update casos_candidatos_eval
         set estado = ${estado}, revisado_en = now(), nota_revision = ${nota}
       where id = ${id}
       returning id`.execute(trx);
    if (!r.rows[0]) throw new TurnoNoEncontradoError();
  });
}
