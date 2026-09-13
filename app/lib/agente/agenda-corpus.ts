// app/lib/agente/agenda-corpus.ts
//
// EL CORPUS DE AGENDA — servidor (14-09-2026, rediseño por falsabilidad).
//
// De dónde sale la lista: NO hay una copia del corpus. Los candidatos se
// recalculan en cada carga pasando el enrutador (agenda-enrutador.ts) por lo
// que ya está guardado en `agente_sombra` —lo que el código envió y lo que el
// modelo habría escrito, con su hilo alrededor— y lo único que se persiste es
// el juicio (`agenda_corpus`). Una sola verdad: si mañana se rejuegan los
// hilos, la lista se mueve sola y las etiquetas siguen pegadas a su mensaje
// por la clave (y por el texto congelado, para poder verlo si divergen).
//
// A CIEGAS, y es una condición, no una preferencia: `listarCorpusAgenda` NO
// selecciona ni una de las columnas `juicio_*`. No es que la pantalla no las
// pinte — es que no viajan. La comparación se lee en otra ruta, cuando la
// lista esté terminada.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import {
  senalDeAgenda,
  type CandidatoAgenda,
  type EtiquetaAgenda,
  type FuenteCandidato,
  type ResumenCorpus,
  type TurnoDelHilo,
} from "./agenda-enrutador";

type FilaSombra = {
  origen: string;
  variante: string;
  telefono: string;
  mensaje_id: string;
  turno: number | null;
  hilo_etiqueta: string | null;
  persona: string | null;
  entrante: string;
  mensaje_codigo: string;
  mensaje_modelo: string;
  created_at: Date | string;
};

type FilaEtiqueta = {
  clave: string;
  etiqueta: EtiquetaAgenda | null;
  se_arroga: boolean | null;
  nota: string | null;
  en: Date | string | null;
};

const iso = (d: Date | string | null): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

export const claveCandidato = (mensajeId: string, fuente: FuenteCandidato) => `${mensajeId}|${fuente}`;

/** El texto de cada fuente en un turno. `null` = esa fuente no existe para
 *  este turno (p. ej. la variante libre no se calculó). */
function textosDelTurno(porVariante: Map<string, FilaSombra>): Partial<Record<FuenteCandidato, string>> {
  const produccion = porVariante.get("produccion");
  const libre = porVariante.get("libre");
  const cualquiera = produccion ?? libre ?? [...porVariante.values()][0];
  return {
    // El mensaje del código es el mismo en todas las variantes: una sola vez.
    codigo: cualquiera?.mensaje_codigo,
    modelo_produccion: produccion?.mensaje_modelo,
    modelo_libre: libre?.mensaje_modelo,
  };
}

/** Todos los candidatos del cliente, en orden de lectura (hilo y turno), con
 *  su etiqueta si ya la tiene. Sin el juicio: se etiqueta a ciegas. */
export async function listarCorpusAgenda(): Promise<{ candidatos: CandidatoAgenda[]; resumen: ResumenCorpus }> {
  const cliente = requireCliente("listarCorpusAgenda");
  const { filas, etiquetas } = await runWithClienteDb(cliente, async (trx) => {
    const s = await sql<FilaSombra>`select origen, variante, telefono, mensaje_id, turno, hilo_etiqueta, persona,
          entrante, mensaje_codigo, mensaje_modelo, created_at
        from agente_sombra
        order by created_at desc
        limit 4000`.execute(trx);
    // A CIEGAS: aquí no se pide `juicio`, `juicio_se_arroga` ni `juicio_por_que`.
    const e = await sql<FilaEtiqueta>`select clave, etiqueta, se_arroga, nota, en from agenda_corpus`.execute(trx);
    return { filas: s.rows, etiquetas: e.rows };
  });

  // Por turno, la fila vigente de cada variante (las filas vienen de más nueva
  // a más vieja: la primera de cada variante es la buena).
  const porTurno = new Map<string, Map<string, FilaSombra>>();
  const ordenTurno: string[] = [];
  for (const f of filas) {
    let v = porTurno.get(f.mensaje_id);
    if (!v) {
      v = new Map();
      porTurno.set(f.mensaje_id, v);
      ordenTurno.push(f.mensaje_id);
    }
    if (!v.has(f.variante)) v.set(f.variante, f);
  }

  // El hilo alrededor: los turnos de ese teléfono en orden de conversación.
  const porHilo = new Map<string, { mensajeId: string; fila: FilaSombra }[]>();
  for (const mensajeId of ordenTurno) {
    const v = porTurno.get(mensajeId)!;
    const f = v.get("produccion") ?? [...v.values()][0]!;
    const lista = porHilo.get(f.telefono) ?? [];
    lista.push({ mensajeId, fila: f });
    porHilo.set(f.telefono, lista);
  }
  for (const lista of porHilo.values()) {
    lista.sort((a, b) => {
      const ta = a.fila.turno, tb = b.fila.turno;
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      const ea = iso(a.fila.created_at) ?? "", eb = iso(b.fila.created_at) ?? "";
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
  }

  const porClave = new Map(etiquetas.map((e) => [e.clave, e]));
  const candidatos: CandidatoAgenda[] = [];

  for (const [telefono, lista] of porHilo) {
    for (const { mensajeId, fila } of lista) {
      const textos = textosDelTurno(porTurno.get(mensajeId)!);
      const turnos: TurnoDelHilo[] = lista.map((x) => ({
        turno: x.fila.turno,
        entrante: x.fila.entrante,
        respuesta: x.fila.mensaje_codigo,
        esElCandidato: x.mensajeId === mensajeId,
      }));
      for (const fuente of ["codigo", "modelo_produccion", "modelo_libre"] as const) {
        const texto = textos[fuente];
        if (!texto) continue;
        const senal = senalDeAgenda(texto);
        if (!senal.candidato) continue;
        const clave = claveCandidato(mensajeId, fuente);
        const e = porClave.get(clave);
        candidatos.push({
          clave,
          mensajeId,
          fuente,
          telefono,
          hilo: fila.hilo_etiqueta ?? fila.persona ?? telefono,
          persona: fila.persona,
          origen: fila.origen,
          texto,
          senal,
          dichoPorLaPersona: fila.entrante,
          turnos,
          en: iso(fila.created_at) ?? "",
          etiqueta: e?.etiqueta ?? null,
          seArroga: e?.se_arroga ?? null,
          nota: e?.nota ?? null,
          etiquetadoEn: iso(e?.en ?? null),
        });
      }
    }
  }

  const resumen: ResumenCorpus = {
    candidatos: candidatos.length,
    etiquetados: candidatos.filter((c) => c.etiqueta != null).length,
    afirma: candidatos.filter((c) => c.etiqueta === "afirma").length,
    repite: candidatos.filter((c) => c.etiqueta === "repite").length,
    ninguno: candidatos.filter((c) => c.etiqueta === "ninguno").length,
    seArroga: candidatos.filter((c) => c.seArroga != null).length,
    hilos: porHilo.size,
  };
  return { candidatos, resumen };
}

/** El texto del candidato, leído del servidor. El cliente manda la clave, no
 *  el mensaje: lo que se congela en el corpus tiene que salir de la misma
 *  fuente que la lista, o la etiqueta acabaría pegada a un texto que nadie
 *  vio. `null` = esa clave no existe para este cliente. */
async function textoDeClave(clave: string): Promise<{ mensajeId: string; fuente: FuenteCandidato; texto: string; telefono: string } | null> {
  const corte = clave.lastIndexOf("|");
  if (corte <= 0) return null;
  const mensajeId = clave.slice(0, corte);
  const fuente = clave.slice(corte + 1) as FuenteCandidato;
  if (fuente !== "codigo" && fuente !== "modelo_produccion" && fuente !== "modelo_libre") return null;
  const cliente = requireCliente("textoDeClave");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<FilaSombra>`select origen, variante, telefono, mensaje_id, turno, hilo_etiqueta, persona,
          entrante, mensaje_codigo, mensaje_modelo, created_at
        from agente_sombra where mensaje_id = ${mensajeId}
        order by created_at desc`.execute(trx),
  );
  if (r.rows.length === 0) return null;
  const porVariante = new Map<string, FilaSombra>();
  for (const f of r.rows) if (!porVariante.has(f.variante)) porVariante.set(f.variante, f);
  const texto = textosDelTurno(porVariante)[fuente];
  if (!texto) return null;
  return { mensajeId, fuente, texto, telefono: r.rows[0]!.telefono };
}

/** La etiqueta de Simon sobre un candidato. Las dos preguntas van por separado
 *  (`etiqueta` y `seArroga`) y se pueden contestar en llamadas distintas:
 *  `undefined` = no se toca, `null` = se borra. false = la clave no existe
 *  (§1: una escritura que no toca fila no es un éxito). */
export async function anotarEtiquetaAgenda(a: {
  clave: string;
  etiqueta?: EtiquetaAgenda | null;
  seArroga?: boolean | null;
  nota?: string | null;
  por: string;
}): Promise<boolean> {
  const c = await textoDeClave(a.clave);
  if (!c) return false;
  const cliente = requireCliente("anotarEtiquetaAgenda");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ id: string }>`insert into agenda_corpus (cliente, clave, mensaje_id, fuente, telefono, texto, etiqueta, se_arroga, nota, por, en)
        values (${cliente}, ${a.clave}, ${c.mensajeId}, ${c.fuente}, ${c.telefono}, ${c.texto},
                ${a.etiqueta ?? null}, ${a.seArroga ?? null}, ${a.nota ?? null}, ${a.por}, ${new Date()})
        on conflict (cliente, clave) do update set
          texto = excluded.texto,
          etiqueta = ${a.etiqueta === undefined ? sql`agenda_corpus.etiqueta` : sql`${a.etiqueta}`},
          se_arroga = ${a.seArroga === undefined ? sql`agenda_corpus.se_arroga` : sql`${a.seArroga}`},
          nota = ${a.nota === undefined ? sql`agenda_corpus.nota` : sql`${a.nota}`},
          por = excluded.por, en = excluded.en
        returning id`.execute(trx),
  );
  return r.rows.length === 1;
}
