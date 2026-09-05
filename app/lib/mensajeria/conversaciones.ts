// app/lib/mensajeria/conversaciones.ts
//
// La lista de la bandeja: todas las conversaciones, la más reciente arriba.
//
// ─── Qué es una conversación aquí ──────────────────────────────────────────
//
// Un TELÉFONO, no un caso. Es la diferencia con Seguimiento, que ordena por
// caso —presupuesto o lead— porque su pregunta es «¿qué hago ahora?». La
// pregunta de la bandeja es «¿qué está pasando?», y eso se mira por persona: la
// misma persona puede tener un lead y un presupuesto, y en su WhatsApp eso es
// una sola conversación. Hoy son 26 teléfonos que son lead Y paciente a la vez.
//
// Hasta la migración 018 esto no se podía hacer: el webhook guardaba el teléfono
// en dígitos y el resto del sistema en E.164, así que agrupar por teléfono
// partía a la misma persona en dos hilos.
//
// ─── Una consulta, no N+1 ──────────────────────────────────────────────────
//
// Todo lo que pinta una línea —último mensaje, hora, pendientes, nombre,
// clínica, si contestó el agente— sale de UNA consulta. La alternativa
// (listar teléfonos y luego resolver el nombre de cada uno) son 50 consultas
// por pantalla, y el nombre es justo lo que no puede faltar: una lista de
// números no se puede navegar.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { colaDeSeguimiento, type Cohorte } from "../seguimiento/cola";
import { esperasYAsumidosPorDigitos } from "../automatizacion/semaforo";
import { esLeadActivo } from "../leads/pipeline";

// ─── Fase C (22-08): la bandeja es LA LISTA COMPLETA ───────────────────────
//
// Sin elegir nada al entrar. Encima, TRES filtros que estrechan la misma
// lista (lentes, no carpetas — los conjuntos se solapan; uno activo a la
// vez, o ninguno):
//   · necesitan-de-mi — el teléfono tiene un caso en la COLA de Seguimiento.
//     El criterio es la cola, no una fórmula propia: aquí murió el
//     `necesita_persona` paralelo (quiebre viejo OR derivado), que ni
//     incluía pendiente_responder ni los listos para cerrar.
//   · agente — el último SALIENTE del hilo lo redactó el agente y nadie ha
//     asumido el hilo. OJO: no «el último mensaje» — eso apagaba la señal
//     justo cuando el paciente escribía, o sea, justo cuando el agente
//     estaba trabajando.
//   · sin-respuesta — el último mensaje del hilo es un saliente HUMANO:
//     escribiste tú y ahí se quedó. Es donde el caso se enfría solo — no
//     reclama, no sale en Seguimiento. Una espera pactada cumple el criterio
//     y NO se esconde: su etiqueta la explica.
//   · sin-evaluar — (auditoría 2026-09-05, MEJORAS 128) el último mensaje
//     del paciente es legible, el evaluador está encendido para su clínica,
//     han pasado más de tres minutos y NO hay evaluación de ese mensaje. Es
//     el contador que faltaba: hasta hoy un fallo del agente se veía igual
//     que un caso normal sin borrador. Excluye los hilos en manos de una
//     persona (derivado sin resolver / asumido), donde el agente calla por
//     diseño.
export type FiltroBandeja = "necesitan-de-mi" | "agente" | "sin-respuesta" | "sin-evaluar";

/** El orden REORDENA, no filtra (dictado): recientes (default) o antiguos
 *  primero — «lo que llevo más tiempo sin tocar». Se aplica ANTES del corte
 *  del límite: ordenar «antiguos» sobre las 60 más recientes sería mentir. */
export type OrdenBandeja = "recientes" | "antiguos";

/** La etiqueta de estado del flujo de la fila (fase C): en qué punto está el
 *  caso SIN abrir la conversación. Derivada, nunca persistida. Una por fila,
 *  por precedencia: cohorte de la cola (mismas palabras y mismo cálculo que
 *  Seguimiento) > semáforo (asumido gana a espera, su precedencia) >
 *  seguimiento automático (caso vivo que trabaja la cadencia) > nada. */
export type EstadoFlujo = {
  clase:
    | "necesita_respuesta"
    | "listo_para_cerrar"
    | "fuera_de_plazo"
    | "asumido"
    | "espera"
    | "automatico";
  /** Solo `espera`: hasta cuándo (YYYY-MM-DD, inclusive). */
  hasta?: string;
};

export type Conversacion = {
  /** El teléfono en E.164. Es la clave del hilo. */
  telefono: string;
  /** Nombre resuelto: paciente → lead → perfil de WhatsApp → el número. */
  nombre: string;
  /** De dónde salió el nombre, para que la UI pueda decirlo cuando no es fiable. */
  origenNombre: "paciente" | "lead" | "perfil" | "telefono";
  /** Texto del último mensaje. TEXTO, nunca marcado — ver nota abajo. */
  ultimoTexto: string;
  ultimoEs: "Entrante" | "Saliente";
  ultimoAt: string;
  /** Entrantes posteriores a nuestra última salida. El contador tipo WhatsApp. */
  pendientes: number;
  clinicaId: string | null;
  clinicaNombre: string | null;
  pacienteId: string | null;
  leadId: string | null;
  presupuestoId: string | null;
  /** El último SALIENTE del hilo lo redactó el agente (lo mandara quien lo
   *  mandara — `sugerido_por_ia`, 018) y nadie ha asumido el hilo: el agente
   *  es quien está contestando. Fase C: antes se miraba el último MENSAJE y
   *  la señal se apagaba en cuanto el paciente escribía. */
  agenteAlMando: boolean;
  /** El último mensaje del hilo es un saliente HUMANO (fase C): escribiste
   *  tú y el paciente no ha contestado, desde este instante. */
  sinRespuestaDesde: string | null;
  /** La etiqueta de estado del flujo (fase C) — ver `EstadoFlujo`. */
  estadoFlujo: EstadoFlujo | null;
  /** MEJORAS 128 — el último mensaje del paciente NO tiene evaluación del
   *  agente aunque debería (ver el filtro `sin-evaluar`). */
  sinEvaluar: boolean;
  /** MEJORAS 122 — todas las clínicas por las que ha pasado el hilo. Más de
   *  una = la conversación cruza la red y el hilo etiqueta cada mensaje. */
  clinicasDelHilo: string[];
};

/**
 * `contenido` puede traer cualquier cosa que haya escrito un paciente. Se manda
 * como TEXTO PLANO y la UI lo pinta como texto: nunca `dangerouslySetInnerHTML`,
 * nunca markdown renderizado. Aquí solo se aplana para que la línea de
 * previsualización no se rompa con saltos.
 */
function previsualizacion(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

export async function listarConversaciones(args: {
  /** null = la lista completa, sin lente (fase C: es la vista por defecto). */
  filtro: FiltroBandeja | null;
  orden?: OrdenBandeja;
  /** null = todas las que el usuario pueda ver. */
  clinicaId?: string | null;
  /** Clínicas a las que esta sesión tiene acceso. `null` = red completa.
   *  Fail-closed: una lista vacía no ve nada, no lo ve todo. */
  clinicasPermitidas: string[] | null;
  limite?: number;
}): Promise<{
  conversaciones: Conversacion[];
  sinClinica: number;
  /** Cuántas había ANTES de cortar por el límite. La lista es acotada a
   *  propósito (no hay scroll infinito), pero un tope que no se declara es un
   *  tope que se lee como «esto es todo lo que hay». */
  totalDelFiltro: number;
  /** MEJORAS 128 — hilos visibles cuyo último mensaje debería estar evaluado
   *  y no lo está. Sobre TODO lo visible, no sobre el filtro. */
  sinEvaluar: number;
}> {
  const cliente = requireCliente("mensajeria/conversaciones");
  const limite = Math.min(args.limite ?? 60, 200);
  const esRed = args.clinicasPermitidas === null;

  const filas = await runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`
      with ultimo as (
        select distinct on (telefono)
               telefono, contenido, direccion, "timestamp",
               (autor = 'agente' or sugerido_por_ia is true) as del_agente
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null
         order by telefono, "timestamp" desc
      ),
      -- El último SALIENTE, aparte del último mensaje (fase C): la señal
      -- «lo lleva el agente» se lee de quién CONTESTÓ por última vez, no
      -- del último mensaje — que la apagaba justo cuando el paciente
      -- escribía, o sea, justo cuando el agente estaba trabajando.
      ult_sal as (
        select distinct on (telefono)
               telefono,
               (autor = 'agente' or sugerido_por_ia is true) as del_agente
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null
           and direccion = 'Saliente'
         order by telefono, "timestamp" desc
      ),
      -- ─── El CASO del hilo: el último valor NO NULO de cada campo ─────
      --
      -- Antes todo salía del ÚLTIMO mensaje, y eso rompió en producción el
      -- 12 de agosto: «Registrar respuesta» crea entrantes que llegan solo
      -- con presupuesto_id, así que UNA acción degradaba la fila entera —
      -- «Cristina Muñoz · Clínica Demo Centro» pasaba a ser un teléfono
      -- pelado «sin clínica». La identidad de una conversación es del HILO,
      -- no de su último mensaje.
      caso as (
        select telefono,
               (array_agg(paciente_id order by "timestamp" desc)
                  filter (where paciente_id is not null))[1]    as paciente_id,
               (array_agg(lead_id order by "timestamp" desc)
                  filter (where lead_id is not null))[1]        as lead_id,
               (array_agg(presupuesto_id order by "timestamp" desc)
                  filter (where presupuesto_id is not null))[1] as presupuesto_id,
               (array_agg(clinica_id order by "timestamp" desc)
                  filter (where clinica_id is not null))[1]     as clinica_id,
               (array_agg(nombre_perfil order by "timestamp" desc)
                  filter (where nombre_perfil is not null and nombre_perfil <> ''))[1] as nombre_perfil,
               -- MEJORAS 122: TODAS las clínicas por las que ha pasado el hilo
               -- (el aislamiento es «cualquiera de ellas», no «la última»).
               array_remove(array_agg(distinct clinica_id), null) as clinicas_ids
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null
         group by telefono
      ),
      pend as (
        select m.telefono, count(*)::int as n
          from mensajes_whatsapp m
         where m.direccion = 'Entrante' and m."timestamp" is not null
           and m."timestamp" > coalesce(
                 (select max(s."timestamp") from mensajes_whatsapp s
                   where s.telefono = m.telefono and s.direccion = 'Saliente'),
                 '-infinity'::timestamptz)
         group by m.telefono
      ),
      -- MEJORAS 128: el último ENTRANTE de cada hilo, para saber si el agente
      -- lo evaluó. Solo cuenta lo legible (034), con id de Meta, con más de
      -- tres minutos (el after() tarda), con el evaluador encendido para su
      -- clínica, y sin nadie al mando (derivado/asumido sin cerrar).
      ult_ent as (
        select distinct on (telefono) telefono, waba_message_id, tipo, "timestamp"
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null and direccion = 'Entrante'
         order by telefono, "timestamp" desc
      ),
      sin_eval as (
        select ue.telefono
          from ult_ent ue
          join caso k using (telefono)
          left join configuracion_automatizaciones ca
                 on ca.cliente = ${cliente} and ca.clinica_id is not distinct from k.clinica_id
         where ue.waba_message_id is not null
           and coalesce(ue.tipo, 'text') in ('text', 'button', 'interactive', 'reaction')
           and ue."timestamp" < now() - interval '3 minutes'
           and ca.evaluador_activo = true
           and not exists (
             select 1 from eventos_automatizacion ev
              where ev.cliente = ${cliente} and ev.tipo_caso = 'conversacion'
                and ev.evento in ('evaluacion', 'derivado')
                and ev.mensaje_id = ue.waba_message_id)
           and not exists (
             select 1 from eventos_automatizacion d
              where d.cliente = ${cliente} and d.tipo_caso = 'conversacion'
                and d.caso_id = ue.telefono
                and d.evento in ('derivado', 'asumido_manual')
                and d.created_at > coalesce(
                  (select max(r.created_at) from eventos_automatizacion r
                    where r.cliente = ${cliente} and r.tipo_caso = 'conversacion'
                      and r.caso_id = ue.telefono
                      and r.evento in ('resuelto_manual', 'soltado')),
                  '-infinity'::timestamptz))
      )
      select u.telefono, u.contenido, u.direccion, u."timestamp", u.del_agente,
             k.clinica_id, k.clinicas_ids, k.paciente_id, k.lead_id, k.presupuesto_id,
             coalesce(p.n, 0) as pendientes,
             (se.telefono is not null) as sin_evaluar,
             coalesce(pa.nombre, l.nombre, k.nombre_perfil) as nom,
             case when pa.nombre is not null then 'paciente'
                  when l.nombre  is not null then 'lead'
                  when k.nombre_perfil is not null then 'perfil'
                  else 'telefono' end as origen,
             c.nombre as clinica_nombre,
             us.del_agente as sal_del_agente,
             -- Para la etiqueta «seguimiento automático»: si el caso del
             -- hilo sigue VIVO (mismo criterio que la cola: presupuesto no
             -- cerrado / lead activo), la cadencia lo trabaja.
             pr.estado as pr_estado,
             l.estado  as lead_estado
        from ultimo u
        join caso k using (telefono)
        left join pend p on p.telefono = u.telefono
        left join ult_sal us on us.telefono = u.telefono
        left join pacientes pa on pa.cliente = ${cliente} and pa.id = k.paciente_id
        left join leads     l  on l.cliente  = ${cliente} and l.id  = k.lead_id
        left join clinicas  c  on c.cliente  = ${cliente} and c.id  = k.clinica_id
        left join presupuestos pr on pr.cliente = ${cliente} and pr.id = k.presupuesto_id
        left join sin_eval se on se.telefono = u.telefono
       order by u."timestamp" desc
    `.execute(trx);
    return r.rows as any[];
  });

  // ─── Las dos fuentes del estado del flujo (fase C), en paralelo ───────────
  //
  //  · LA COLA de Seguimiento: el criterio de «necesitan de mí» y las tres
  //    etiquetas de cohorte. UN cálculo en todo el producto — aquí murió el
  //    `necesita_persona` paralelo. La cola asume de más (no re-deriva los
  //    cierres por hechos); la ficha lo dice exacto — doctrina declarada.
  //  · EL SEMÁFORO sin hechos: esperas vigentes y asumidos, con sus reglas.
  const [cola, semaforos] = await Promise.all([
    colaDeSeguimiento(),
    esperasYAsumidosPorDigitos(),
  ]);
  const dig = (t: unknown) => String(t ?? "").replace(/\D/g, "");
  const cohortePorDigitos = new Map<string, Cohorte>();
  for (const caso of cola.casos) {
    const d = dig(caso.telefono);
    if (d) cohortePorDigitos.set(d, caso.cohorte);
  }
  // Los teléfonos llegan en formatos distintos («+34 613…» vs «34613…»):
  // el matching es por dígitos con inclusión bidireccional — la semántica
  // de todo el sistema (018), no una igualdad de strings.
  function buscarPorDigitos<T>(mapa: Map<string, T>, d: string): T | null {
    if (!d) return null;
    const exacto = mapa.get(d);
    if (exacto !== undefined) return exacto;
    for (const [k, v] of mapa) if (k.includes(d) || d.includes(k)) return v;
    return null;
  }

  const COHORTE_A_CLASE: Record<Cohorte, EstadoFlujo["clase"]> = {
    necesita_respuesta: "necesita_respuesta",
    listos_para_cerrar: "listo_para_cerrar",
    fuera_de_plazo: "fuera_de_plazo",
  };

  const derivarFlujo = (f: any): EstadoFlujo | null => {
    const d = dig(f.telefono);
    const cohorte = buscarPorDigitos(cohortePorDigitos, d);
    if (cohorte) return { clase: COHORTE_A_CLASE[cohorte] };
    const sem = buscarPorDigitos(semaforos, d);
    if (sem?.asumido) return { clase: "asumido" };
    if (sem?.espera) return { clase: "espera", hasta: sem.espera.hasta };
    const presupuestoVivo =
      f.presupuesto_id != null &&
      (f.pr_estado == null || !["ACEPTADO", "PERDIDO"].includes(String(f.pr_estado)));
    const leadVivo = f.lead_id != null && esLeadActivo(String(f.lead_estado ?? ""));
    if (presupuestoVivo || leadVivo) return { clase: "automatico" };
    return null;
  };

  // El aislamiento se aplica AQUÍ y no en el SQL a propósito: así el recuento de
  // «sin clínica» se puede dar sin enseñar ni una línea de su contenido, que es
  // exactamente la decisión del 2026-08-11 — se declara su existencia, no su
  // contenido.
  // MEJORAS 122 (decisión 2026-09-05): el hilo es de la persona — lo ve quien
  // tenga acceso a CUALQUIERA de sus clínicas, y el filtro por clínica lo
  // incluye si ha pasado por ella. Misma regla que lib/mensajeria/acceso-hilo.
  const clinicasDe = (f: any): string[] => (Array.isArray(f.clinicas_ids) ? f.clinicas_ids.map(String) : []);
  const visibles = filas.filter((f) => {
    const cls = clinicasDe(f);
    if (cls.length === 0) return esRed;
    if (!esRed && !cls.some((c) => args.clinicasPermitidas!.includes(c))) return false;
    if (args.clinicaId) return cls.includes(args.clinicaId);
    return true;
  });

  // Se cuenta para TODOS, tengan o no acceso de red: la decisión es declarar su
  // existencia sin su contenido. Quien no puede verlas sabe que están y sabe
  // cuántas; lo que no ve es de quién son.
  const sinClinica = filas.filter((f) => f.clinica_id == null).length;

  // Las señales derivadas, UNA vez por fila (las usan el filtro y la salida).
  const EN_COLA: ReadonlySet<EstadoFlujo["clase"]> = new Set([
    "necesita_respuesta",
    "listo_para_cerrar",
    "fuera_de_plazo",
  ]);
  const derivadas = visibles.map((f) => {
    const estadoFlujo = derivarFlujo(f);
    const asumido = estadoFlujo?.clase === "asumido" ||
      buscarPorDigitos(semaforos, dig(f.telefono))?.asumido === true;
    return {
      f,
      estadoFlujo,
      agenteAlMando: f.sal_del_agente === true && !asumido,
      sinRespuestaDesde:
        f.direccion === "Saliente" && f.del_agente !== true
          ? new Date(f.timestamp).toISOString()
          : null,
    };
  });

  const conFiltro = derivadas.filter((x) => {
    switch (args.filtro) {
      case "necesitan-de-mi":
        return x.estadoFlujo != null && EN_COLA.has(x.estadoFlujo.clase);
      case "agente":
        return x.agenteAlMando;
      case "sin-respuesta":
        return x.sinRespuestaDesde != null;
      case "sin-evaluar":
        return x.f.sin_evaluar === true;
      case null:
        return true;
    }
  });
  // El contador de «sin evaluar» se da sobre TODO lo visible, no sobre el
  // filtro: es una alarma, y una alarma que solo suena cuando la miras no es
  // una alarma.
  const sinEvaluar = derivadas.filter((x) => x.f.sin_evaluar === true).length;

  // El orden se aplica sobre el conjunto COMPLETO del filtro, antes del
  // corte del límite: «antiguos primero» sobre las 60 más recientes
  // enseñaría justo lo contrario de lo que promete.
  if (args.orden === "antiguos") conFiltro.reverse();

  return {
    totalDelFiltro: conFiltro.length,
    conversaciones: conFiltro.slice(0, limite).map(({ f, estadoFlujo, agenteAlMando, sinRespuestaDesde }) => ({
      telefono: String(f.telefono),
      nombre: String(f.nom ?? "") || String(f.telefono),
      origenNombre: String(f.origen ?? "telefono") as Conversacion["origenNombre"],
      ultimoTexto: previsualizacion(f.contenido),
      ultimoEs: f.direccion === "Entrante" ? "Entrante" : "Saliente",
      ultimoAt: new Date(f.timestamp).toISOString(),
      pendientes: Number(f.pendientes) || 0,
      clinicaId: f.clinica_id ? String(f.clinica_id) : null,
      clinicaNombre: f.clinica_nombre ? String(f.clinica_nombre) : null,
      pacienteId: f.paciente_id ? String(f.paciente_id) : null,
      leadId: f.lead_id ? String(f.lead_id) : null,
      presupuestoId: f.presupuesto_id ? String(f.presupuesto_id) : null,
      agenteAlMando,
      sinRespuestaDesde,
      estadoFlujo,
      sinEvaluar: f.sin_evaluar === true,
      clinicasDelHilo: clinicasDe(f),
    })),
    sinClinica,
    sinEvaluar,
  };
}

/** El hilo completo de un teléfono. Mismo criterio: la conversación es de la
 *  persona, así que trae sus mensajes aunque toquen dos casos distintos. */
export async function hiloDe(telefono: string, limite = 200) {
  const cliente = requireCliente("mensajeria/hilo");
  return runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`
      select id, contenido, direccion, "timestamp", autor, sugerido_por_ia,
             paciente_id, lead_id, presupuesto_id, clinica_id, tipo, media_id
        from mensajes_whatsapp
       where telefono = ${telefono} and "timestamp" is not null
       order by "timestamp" asc
       limit ${limite}
    `.execute(trx);
    return (r.rows as any[]).map((m) => ({
      id: String(m.id),
      contenido: String(m.contenido ?? ""),
      direccion: m.direccion === "Entrante" ? ("Entrante" as const) : ("Saliente" as const),
      timestamp: new Date(m.timestamp).toISOString(),
      autor: m.autor ? String(m.autor) : null,
      sugeridoPorIa: m.sugerido_por_ia === true,
      pacienteId: m.paciente_id ? String(m.paciente_id) : null,
      leadId: m.lead_id ? String(m.lead_id) : null,
      presupuestoId: m.presupuesto_id ? String(m.presupuesto_id) : null,
      clinicaId: m.clinica_id ? String(m.clinica_id) : null,
      // 034 — qué es. NULL = texto (fila anterior a la migración).
      tipo: m.tipo ? String(m.tipo) : null,
      mediaId: m.media_id ? String(m.media_id) : null,
    }));
  });
}


// (fase C: `necesitanPersonaPorClinica` murió aquí — /red cuenta ahora
//  directamente de la COLA de Seguimiento, el mismo cálculo que el filtro
//  «necesitan de mí» de la bandeja. Un solo número en todo el producto.)
