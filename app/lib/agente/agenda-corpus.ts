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
  type FilaComparada,
  type FuenteCandidato,
  type JuicioDelModelo,
  type MensajeDelHilo,
  type OrigenCorpus,
  type ResumenCorpus,
} from "./agenda-enrutador";
import { huellaTexto } from "./version";

type FilaSombra = {
  origen: "produccion" | "hilos_jugados";
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

/** Una conversación entera de `hilos:tres`: un guion contestado por UN decisor.
 *  Vive en otra tabla que la sombra turno a turno, y el corpus se la dejaba
 *  fuera hasta el 14-09 — eran 38 candidatos invisibles, los más recientes. */
type FilaGuion = {
  guion_id: string;
  titulo: string;
  decisor: string;
  mensajes: unknown;
  jugado_el: Date | string;
};

type MensajeGuion = { n: number; quien: "paciente" | "agente" | "cadencia"; texto: string; borrador?: string | null };

type FilaEtiqueta = {
  clave: string;
  etiqueta: EtiquetaAgenda | null;
  se_arroga: boolean | null;
  nota: string | null;
  en: Date | string | null;
  /** El texto que Simon tenía delante al etiquetar. Se lee para poder decir
   *  POR QUÉ una etiqueta se quedó sin candidato (MEJORAS 239): si ese texto
   *  ya no es candidato para el enrutador es una baja conocida; si lo es, el
   *  mensaje ha desaparecido y eso sí es una alarma. */
  texto: string | null;
};

const iso = (d: Date | string | null): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

/** LA IDENTIDAD DE UN CANDIDATO, Y LLEVA EL TEXTO DENTRO (MEJORAS 239, 14-09).
 *
 *  Hasta hoy era `<mensajeId>|<fuente>`: el turno y de dónde salió, NADA del
 *  mensaje. Y las dos tablas de las que se leen los candidatos se reemplazan
 *  al rejugar (`agente_sombra_hilos` hace upsert por (cliente, guion, decisor);
 *  la sombra, por variante y turno). O sea que un `npm run hilos:tres` normal
 *  —lo más razonable del mundo— dejaba las 91 etiquetas de Simon, 32 de ellas
 *  en la vara del juez, pegadas a mensajes que él no ha leído. **La nota del
 *  instrumento habría cambiado sin que nadie tocara el instrumento**, y ese es
 *  el peor fallo posible en algo que existe para medir: invisible.
 *
 *  Con la huella del texto dentro, rejugar produce candidatos con clave NUEVA:
 *  salen sin etiqueta y se ven como pendientes, y la fila vieja se queda sin
 *  candidato — contada en `resumen.huerfanas`, no escondida. Se prefiere perder
 *  una etiqueta EN ALTO a heredarla en falso.
 *
 *  La huella va al final y no al principio para que la clave se siga leyendo
 *  («guion:caso_completo:alcance:2|codigo|a1b2…»), y se lee de derecha a
 *  izquierda porque un `mensajeId` puede llevar «|» dentro. */
export const claveCandidato = (mensajeId: string, fuente: FuenteCandidato, texto: string) =>
  `${mensajeId}|${fuente}|${huellaTexto(texto)}`;

/** El reverso de `claveCandidato`. `null` = no tiene la forma de una clave (o
 *  es una de las viejas, sin huella: la migración 055 las convirtió, y una que
 *  llegue hoy sin huella es una clave inventada). */
export function leerClave(clave: string): { mensajeId: string; fuente: FuenteCandidato; huella: string } | null {
  const m = clave.match(/^(.+)\|(codigo|modelo_produccion|modelo_libre)\|([0-9a-f]{12})$/);
  if (!m) return null;
  return { mensajeId: m[1]!, fuente: m[2] as FuenteCandidato, huella: m[3]! };
}

/** La identidad de un mensaje de guion. Lleva el decisor dentro porque los
 *  cuatro contestan a la MISMA frase: sin él, cuatro mensajes distintos
 *  compartirían clave y se pisarían la etiqueta. */
const idDeGuion = (guionId: string, decisor: string, n: number) => `guion:${guionId}:${decisor}:${n}`;

/** El texto que se etiqueta de un mensaje de guion: el BORRADOR cuando el
 *  control lo cambió. Lo que se juzga es lo que escribió el agente; lo que
 *  salió ya pasó por la poda, y etiquetarlo mediría el control, no el juicio. */
const textoDelGuion = (m: MensajeGuion) => (m.borrador ?? m.texto ?? "").trim();

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

const leerMensajes = (raw: unknown): MensajeGuion[] => {
  const v = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(v) ? (v as MensajeGuion[]) : [];
};

/** Los candidatos de la sombra turno a turno (fixture de 15 hilos y canal real). */
function candidatosDeLaSombra(filas: FilaSombra[]): Omit<CandidatoAgenda, "etiqueta" | "seArroga" | "nota" | "etiquetadoEn">[] {
  // Por turno, la fila vigente de cada variante (las filas vienen de más nueva
  // a más vieja: la primera de cada variante es la buena). Rejugar con el mismo
  // prompt reemplaza, así que aquí no se acumulan pasadas.
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

  const out: Omit<CandidatoAgenda, "etiqueta" | "seArroga" | "nota" | "etiquetadoEn">[] = [];
  for (const [telefono, lista] of porHilo) {
    for (const { mensajeId, fila } of lista) {
      const textos = textosDelTurno(porTurno.get(mensajeId)!);
      for (const fuente of ["codigo", "modelo_produccion", "modelo_libre"] as const) {
        const texto = textos[fuente];
        if (!texto) continue;
        const senal = senalDeAgenda(texto);
        if (!senal.candidato) continue;
        const mensajes: MensajeDelHilo[] = [];
        for (const x of lista) {
          mensajes.push({ quien: "paciente", texto: x.fila.entrante, esElCandidato: false });
          const esEl = x.mensajeId === mensajeId;
          mensajes.push({ quien: "agente", texto: esEl ? texto : x.fila.mensaje_codigo, esElCandidato: esEl });
        }
        out.push({
          clave: claveCandidato(mensajeId, fuente, texto),
          mensajeId,
          fuente,
          telefono,
          hilo: fila.hilo_etiqueta ?? fila.persona ?? telefono,
          persona: fila.persona,
          origen: fila.origen,
          decisor: null,
          aviso: null,
          texto,
          senal,
          dichoPorLaPersona: fila.entrante,
          mensajes,
          en: iso(fila.created_at) ?? "",
        });
      }
    }
  }
  return out;
}

/** Los candidatos de los cuatro guiones (una fila = un guion contestado por un
 *  decisor). `on conflict (guion, decisor) do update` en origen: aquí tampoco
 *  se acumulan pasadas, solo sobrevive la última de cada combinación. */
function candidatosDeLosGuiones(filas: FilaGuion[]): Omit<CandidatoAgenda, "etiqueta" | "seArroga" | "nota" | "etiquetadoEn">[] {
  const out: Omit<CandidatoAgenda, "etiqueta" | "seArroga" | "nota" | "etiquetadoEn">[] = [];
  for (const f of filas) {
    const ms = leerMensajes(f.mensajes);
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]!;
      if (m.quien !== "agente") continue;
      const texto = textoDelGuion(m);
      const senal = senalDeAgenda(texto);
      if (!texto || !senal.candidato) continue;
      const mensajeId = idDeGuion(f.guion_id, f.decisor, m.n);
      const dicho = [...ms.slice(0, i)].reverse().find((x) => x.quien === "paciente")?.texto ?? "";
      const cambiado = m.borrador != null && m.borrador.trim() !== (m.texto ?? "").trim();
      out.push({
        clave: claveCandidato(mensajeId, "codigo", texto),
        mensajeId,
        fuente: "codigo",
        telefono: null,
        hilo: f.titulo,
        persona: null,
        origen: "guiones",
        decisor: f.decisor,
        aviso: cambiado
          ? "La revisión de seguridad cambió este mensaje antes de enviarlo: aquí se etiqueta lo que escribió el agente, no lo que salió."
          : null,
        texto,
        senal,
        dichoPorLaPersona: dicho,
        mensajes: ms.map((x, j) => ({
          quien: x.quien === "paciente" ? "paciente" : x.quien === "cadencia" ? "clinica" : "agente",
          texto: j === i ? texto : (x.texto ?? ""),
          esElCandidato: j === i,
        })),
        en: iso(f.jugado_el) ?? "",
      });
    }
  }
  return out;
}

/** Todos los candidatos del cliente, en orden de lectura, con su etiqueta si ya
 *  la tiene. Sin el juicio: se etiqueta a ciegas.
 *
 *  EL ORDEN NO ES INOCENTE (14-09): los cuatro guiones van AL FINAL. Son cuatro
 *  situaciones contestadas por cuatro decisores cada una —muchos mensajes, poca
 *  variedad—, y empezar por ahí gasta el criterio de Simon en lo repetido y deja
 *  lo variado para cuando ya está cansado. La pantalla además deja filtrar. */
export async function listarCorpusAgenda(): Promise<{ candidatos: CandidatoAgenda[]; resumen: ResumenCorpus }> {
  const cliente = requireCliente("listarCorpusAgenda");
  const { filas, guiones, etiquetas } = await runWithClienteDb(cliente, async (trx) => {
    const s = await sql<FilaSombra>`select origen, variante, telefono, mensaje_id, turno, hilo_etiqueta, persona,
          entrante, mensaje_codigo, mensaje_modelo, created_at
        from agente_sombra
        order by created_at desc
        limit 4000`.execute(trx);
    const g = await sql<FilaGuion>`select guion_id, titulo, decisor, mensajes, jugado_el
        from agente_sombra_hilos order by guion_id, decisor`.execute(trx);
    // A CIEGAS: aquí no se pide `juicio`, `juicio_se_arroga` ni `juicio_por_que`.
    const e = await sql<FilaEtiqueta>`select clave, etiqueta, se_arroga, nota, en, texto from agenda_corpus`.execute(trx);
    return { filas: s.rows, guiones: g.rows, etiquetas: e.rows };
  });

  const porClave = new Map(etiquetas.map((e) => [e.clave, e]));
  const crudos = [...candidatosDeLaSombra(filas), ...candidatosDeLosGuiones(guiones)];
  const clavesVivas = new Set(crudos.map((c) => c.clave));

  // MEJORAS 239 — LAS ETIQUETAS QUE SE QUEDARON SIN CANDIDATO, en dos montones
  // que NO son lo mismo. Solo cuentan las filas con criterio de Simon dentro:
  // una que solo lleve el veredicto del juicio no es una pérdida (se vuelve a
  // juzgar por $0,0016).
  //   · `huerfanas` — el mensaje ya no está con ese texto: alguien rejugó. ES
  //     LA ALARMA, y su valor normal es cero.
  //   · `fueraDelEnrutador` — el mensaje sigue donde estaba, pero el enrutador
  //     dejó de marcarlo (al quitar la «cita» pelada salieron 10). Van a ser 10
  //     siempre, y sumarlos a la alarma la dejaría encendida en permanente.
  const conCriterio = etiquetas.filter((e) => e.etiqueta != null || e.se_arroga != null || e.nota != null);
  const perdidas = conCriterio.filter((e) => !clavesVivas.has(e.clave));
  const sinCandidato = {
    huerfanas: perdidas.filter((e) => senalDeAgenda(e.texto ?? "").candidato).length,
    fueraDelEnrutador: perdidas.filter((e) => !senalDeAgenda(e.texto ?? "").candidato).length,
  };
  const candidatos: CandidatoAgenda[] = crudos.map((c) => {
    const e = porClave.get(c.clave);
    return {
      ...c,
      etiqueta: e?.etiqueta ?? null,
      seArroga: e?.se_arroga ?? null,
      nota: e?.nota ?? null,
      etiquetadoEn: iso(e?.en ?? null),
    };
  });
  const PESO: Record<OrigenCorpus, number> = { hilos_jugados: 0, produccion: 1, guiones: 2 };
  candidatos.sort((a, b) => PESO[a.origen] - PESO[b.origen]);

  const vacio = () => ({ candidatos: 0, etiquetados: 0, hilos: 0 });
  const porOrigen: Record<OrigenCorpus, { candidatos: number; etiquetados: number; hilos: number }> = {
    hilos_jugados: vacio(),
    produccion: vacio(),
    guiones: vacio(),
  };
  const hilosPorOrigen: Record<OrigenCorpus, Set<string>> = { hilos_jugados: new Set(), produccion: new Set(), guiones: new Set() };
  for (const c of candidatos) {
    porOrigen[c.origen].candidatos++;
    if (c.etiqueta != null) porOrigen[c.origen].etiquetados++;
    hilosPorOrigen[c.origen].add(c.hilo);
  }
  for (const o of Object.keys(porOrigen) as OrigenCorpus[]) porOrigen[o].hilos = hilosPorOrigen[o].size;

  const resumen: ResumenCorpus = {
    candidatos: candidatos.length,
    etiquetados: candidatos.filter((c) => c.etiqueta != null).length,
    afirma: candidatos.filter((c) => c.etiqueta === "afirma").length,
    repite: candidatos.filter((c) => c.etiqueta === "repite").length,
    ninguno: candidatos.filter((c) => c.etiqueta === "ninguno").length,
    seArroga: candidatos.filter((c) => c.seArroga != null).length,
    hilos: new Set(candidatos.map((c) => c.hilo)).size,
    porOrigen,
    ...sinCandidato,
  };
  return { candidatos, resumen };
}

/** El texto del candidato, leído del servidor. El cliente manda la clave, no
 *  el mensaje: lo que se congela en el corpus tiene que salir de la misma
 *  fuente que la lista, o la etiqueta acabaría pegada a un texto que nadie
 *  vio. `null` = esa clave no existe para este cliente. */
async function textoDeClave(clave: string): Promise<{ mensajeId: string; fuente: FuenteCandidato; texto: string; telefono: string | null } | null> {
  const partes = leerClave(clave);
  if (!partes) return null;
  const { mensajeId, fuente, huella } = partes;
  const cliente = requireCliente("textoDeClave");
  // MEJORAS 239 — LA COMPROBACIÓN QUE CIERRA EL AGUJERO, y va aquí porque esta
  // es la única puerta por la que entra una etiqueta de Simon. Si el texto que
  // hay AHORA no es el de la huella, la clave no vale: el mensaje que él leyó
  // ya no existe (se rejugó el hilo entre que cargó la pantalla y pulsó la
  // tecla). Devolver null hace que la API conteste «esa clave no existe» en vez
  // de escribir su criterio encima de un mensaje que no ha visto.
  const verificado = (r: { mensajeId: string; fuente: FuenteCandidato; texto: string; telefono: string | null } | null) =>
    r && huellaTexto(r.texto) === huella ? r : null;
  // Los cuatro guiones viven en otra tabla y su id la lleva dentro.
  if (mensajeId.startsWith("guion:")) {
    const [, guionId, decisor, nCrudo] = mensajeId.split(":");
    const n = Number(nCrudo);
    if (!guionId || !decisor || !Number.isFinite(n)) return null;
    const g = await runWithClienteDb(cliente, (trx) =>
      sql<FilaGuion>`select guion_id, titulo, decisor, mensajes, jugado_el
          from agente_sombra_hilos where guion_id = ${guionId} and decisor = ${decisor}`.execute(trx),
    );
    const fila = g.rows[0];
    if (!fila) return null;
    const m = leerMensajes(fila.mensajes).find((x) => x.quien === "agente" && x.n === n);
    const texto = m ? textoDelGuion(m) : "";
    if (!texto) return null;
    return verificado({ mensajeId, fuente, texto, telefono: null });
  }
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
  return verificado({ mensajeId, fuente, texto, telefono: r.rows[0]!.telefono });
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

// ─── EL JUICIO EN SOMBRA, y su lectura ─────────────────────────────────────
//
// Escribir y leer el juicio vive AQUÍ y NO en `listarCorpusAgenda`, que sigue
// teniendo su lista de columnas escrita a mano y sin `juicio_*`. La ceguera no
// se sostiene con un flag («pásale false y no te lo manda»): se sostiene con
// dos funciones distintas, para que nadie pueda filtrarlo por descuido al
// tocar un parámetro. Cuesta una consulta más y es exactamente lo que compra.

/** Escribe el veredicto del juicio especializado en la fila del candidato.
 *
 *  NO toca NADA de lo de Simon: ni `etiqueta`, ni `se_arroga`, ni `nota`, ni
 *  `por`/`en`. Y no toca `texto` si la fila ya existe: ese texto es el que él
 *  vio al etiquetar, y el juicio no puede reescribir a qué se refiere una
 *  etiqueta ya puesta. Devuelve el texto GUARDADO para que quien llama pueda
 *  ver si juzgó otra cosa (§9: divergencia contada, no silenciosa). */
export async function guardarJuicioAgenda(a: {
  candidato: Pick<CandidatoAgenda, "clave" | "mensajeId" | "fuente" | "telefono" | "texto">;
  etiqueta: EtiquetaAgenda;
  seArroga: boolean | null;
  porQue: string | null;
  version: string;
  modelo: string;
}): Promise<{ textoGuardado: string }> {
  const cliente = requireCliente("guardarJuicioAgenda");
  const c = a.candidato;
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ texto: string }>`insert into agenda_corpus
          (cliente, clave, mensaje_id, fuente, telefono, texto, juicio, juicio_se_arroga, juicio_por_que, juicio_version, juicio_modelo, juicio_en)
        values (${cliente}, ${c.clave}, ${c.mensajeId}, ${c.fuente}, ${c.telefono}, ${c.texto},
                ${a.etiqueta}, ${a.seArroga}, ${a.porQue}, ${a.version}, ${a.modelo}, ${new Date()})
        on conflict (cliente, clave) do update set
          juicio = excluded.juicio,
          juicio_se_arroga = excluded.juicio_se_arroga,
          juicio_por_que = excluded.juicio_por_que,
          juicio_version = excluded.juicio_version,
          juicio_modelo = excluded.juicio_modelo,
          juicio_en = excluded.juicio_en
        returning texto`.execute(trx),
  );
  // §1 — una escritura que no toca fila no es un éxito. Aquí cero filas solo
  // puede ser RLS filtrando, y devolver «ok» escondería un pase entero vacío.
  const fila = r.rows[0];
  if (!fila) throw new Error(`guardarJuicioAgenda: la escritura no tocó ninguna fila (${c.clave})`);
  return { textoGuardado: fila.texto };
}

type FilaJuicio = {
  clave: string;
  juicio: EtiquetaAgenda | null;
  juicio_se_arroga: boolean | null;
  juicio_por_que: string | null;
  juicio_version: string | null;
  juicio_modelo: string | null;
  juicio_en: Date | string | null;
};

const SIN_JUICIO: JuicioDelModelo = { etiqueta: null, seArroga: null, porQue: null, version: null, modelo: null, en: null };

/** Los candidatos con las DOS columnas al lado: la de Simon y la del juicio.
 *  Es la ruta de los desacuerdos, y la única que lee `juicio_*`. */
export async function listarDesacuerdosAgenda(): Promise<{ filas: FilaComparada[]; resumen: ResumenCorpus }> {
  const { candidatos, resumen } = await listarCorpusAgenda();
  const cliente = requireCliente("listarDesacuerdosAgenda");
  const j = await runWithClienteDb(cliente, (trx) =>
    sql<FilaJuicio>`select clave, juicio, juicio_se_arroga, juicio_por_que, juicio_version, juicio_modelo, juicio_en
        from agenda_corpus where juicio is not null`.execute(trx),
  );
  const porClave = new Map(j.rows.map((f) => [f.clave, f]));
  const filas: FilaComparada[] = candidatos.map((c) => {
    const f = porClave.get(c.clave);
    return {
      ...c,
      juicio: f
        ? {
            etiqueta: f.juicio,
            seArroga: f.juicio_se_arroga,
            porQue: f.juicio_por_que,
            version: f.juicio_version,
            modelo: f.juicio_modelo,
            en: iso(f.juicio_en),
          }
        : SIN_JUICIO,
    };
  });
  return { filas, resumen };
}
