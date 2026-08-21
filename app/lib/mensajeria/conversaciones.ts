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
import { INTENCIONES_QUE_QUIEBRAN } from "../automatizacion/estado";

export type FiltroBandeja = "pendientes" | "todas" | "agente" | "necesita-persona";

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
  /** ¿La última respuesta la escribió el agente? (la redactó él, la mandara
   *  quien la mandara — ver `sugerido_por_ia` en la migración 018). */
  ultimaDelAgente: boolean;
  /** El caso necesita criterio de una persona. Dos fuentes (B4, 21-08):
   *  el quiebre del clasificador viejo (`presupuestos.requiere_persona`,
   *  solo presupuestos — recorte del 6 de agosto) y el DERIVADO sin
   *  resolver del log del evaluador, que cubre también leads y huérfanos.
   *  La proyección compat murió (MEJORAS 93): el log es la única verdad
   *  del evaluador. */
  necesitaPersona: boolean;
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
  filtro: FiltroBandeja;
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
                  filter (where nombre_perfil is not null and nombre_perfil <> ''))[1] as nombre_perfil
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
      )
      select u.telefono, u.contenido, u.direccion, u."timestamp", u.del_agente,
             k.clinica_id, k.paciente_id, k.lead_id, k.presupuesto_id,
             coalesce(p.n, 0) as pendientes,
             coalesce(pa.nombre, l.nombre, k.nombre_perfil) as nom,
             case when pa.nombre is not null then 'paciente'
                  when l.nombre  is not null then 'lead'
                  when k.nombre_perfil is not null then 'perfil'
                  else 'telefono' end as origen,
             c.nombre as clinica_nombre,
             -- Dos fuentes, cada una la verdad de SU motor (B4, 21-08):
             --  · Clasificador VIEJO (94): requiere_persona / intención sobre
             --    el presupuesto, solo si el paciente escribió lo último —
             --    mismo criterio que estadoAutomatizacion, no copia a ojo.
             --  · EVALUADOR: derivado sin resuelto_manual posterior en el LOG
             --    (la proyección compat murió con MEJORAS 93). Cubre también
             --    leads y huérfanos — el hueco documentado arriba. El cierre
             --    por HECHOS del semáforo no se re-deriva aquí (igual que en
             --    la cola): se marca de más, jamás de menos; la ficha lo dice
             --    exacto.
             (coalesce(p.n, 0) > 0 and (
                pr.requiere_persona is true
                or (pr.requiere_persona is null
                    and pr.intencion_detectada = any(${INTENCIONES_QUE_QUIEBRAN as string[]}))
             ))
             or exists (
               select 1 from eventos_automatizacion d
                where d.cliente = ${cliente} and d.tipo_caso = 'conversacion'
                  and d.evento = 'derivado'
                  and regexp_replace(d.caso_id, '\\D', '', 'g') = regexp_replace(u.telefono, '\\D', '', 'g')
                  and not exists (
                    select 1 from eventos_automatizacion rs
                     where rs.cliente = d.cliente and rs.tipo_caso = 'conversacion'
                       and rs.evento = 'resuelto_manual'
                       and regexp_replace(rs.caso_id, '\\D', '', 'g') = regexp_replace(d.caso_id, '\\D', '', 'g')
                       and rs.created_at > d.created_at)
             ) as necesita_persona
        from ultimo u
        join caso k using (telefono)
        left join pend p on p.telefono = u.telefono
        left join pacientes pa on pa.cliente = ${cliente} and pa.id = k.paciente_id
        left join leads     l  on l.cliente  = ${cliente} and l.id  = k.lead_id
        left join clinicas  c  on c.cliente  = ${cliente} and c.id  = k.clinica_id
        left join presupuestos pr on pr.cliente = ${cliente} and pr.id = k.presupuesto_id
       order by u."timestamp" desc
    `.execute(trx);
    return r.rows as any[];
  });

  // El aislamiento se aplica AQUÍ y no en el SQL a propósito: así el recuento de
  // «sin clínica» se puede dar sin enseñar ni una línea de su contenido, que es
  // exactamente la decisión del 2026-08-11 — se declara su existencia, no su
  // contenido.
  const visibles = filas.filter((f) => {
    if (f.clinica_id == null) return esRed;
    if (!esRed && !args.clinicasPermitidas!.includes(String(f.clinica_id))) return false;
    if (args.clinicaId) return String(f.clinica_id) === args.clinicaId;
    return true;
  });

  // Se cuenta para TODOS, tengan o no acceso de red: la decisión es declarar su
  // existencia sin su contenido. Quien no puede verlas sabe que están y sabe
  // cuántas; lo que no ve es de quién son.
  const sinClinica = filas.filter((f) => f.clinica_id == null).length;

  const conFiltro = visibles.filter((f) => {
    switch (args.filtro) {
      case "pendientes":
        return Number(f.pendientes) > 0;
      case "agente":
        return f.del_agente === true;
      case "necesita-persona":
        return f.necesita_persona === true;
      case "todas":
        return true;
    }
  });

  return {
    totalDelFiltro: conFiltro.length,
    conversaciones: conFiltro.slice(0, limite).map((f) => ({
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
      ultimaDelAgente: f.del_agente === true,
      necesitaPersona: f.necesita_persona === true,
    })),
    sinClinica,
  };
}

/** El hilo completo de un teléfono. Mismo criterio: la conversación es de la
 *  persona, así que trae sus mensajes aunque toquen dos casos distintos. */
export async function hiloDe(telefono: string, limite = 200) {
  const cliente = requireCliente("mensajeria/hilo");
  return runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`
      select id, contenido, direccion, "timestamp", autor, sugerido_por_ia,
             paciente_id, lead_id, presupuesto_id, clinica_id
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
    }));
  });
}


/**
 * Cuántas conversaciones necesitan una persona, por clínica.
 *
 * Se calcula con la MISMA función que la bandeja y con el mismo filtro, en vez
 * de con una consulta propia sobre `presupuestos`. Podría hacerse más directo;
 * sería también un segundo cálculo del mismo número, y el día que divergieran
 * /red diría 7 y la bandeja enseñaría 5 al hacer clic. Es exactamente el patrón
 * paralelo que llevamos dos meses matando.
 *
 * Las que no tienen clínica NO se reparten ni se suman a ninguna: aparecen
 * aparte, con la misma regla de aislamiento que la banda «Sin asignar».
 */
export async function necesitanPersonaPorClinica(args: {
  clinicasPermitidas: string[] | null;
}): Promise<{ porClinica: Record<string, number>; sinClinica: number }> {
  const { conversaciones } = await listarConversaciones({
    filtro: "necesita-persona",
    clinicasPermitidas: args.clinicasPermitidas,
    limite: 200,
  });
  const porClinica: Record<string, number> = {};
  let sinClinica = 0;
  for (const c of conversaciones) {
    if (!c.clinicaId) {
      sinClinica++;
      continue;
    }
    porClinica[c.clinicaId] = (porClinica[c.clinicaId] ?? 0) + 1;
  }
  return { porClinica, sinClinica };
}
