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
  /** El caso está quebrado: necesita criterio de una persona. */
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
}): Promise<{ conversaciones: Conversacion[]; sinClinica: number }> {
  const cliente = requireCliente("mensajeria/conversaciones");
  const limite = Math.min(args.limite ?? 60, 200);
  const esRed = args.clinicasPermitidas === null;

  const filas = await runWithClienteDb(cliente, async (trx) => {
    const r: any = await sql`
      with ultimo as (
        select distinct on (telefono)
               telefono, contenido, direccion, "timestamp", clinica_id,
               paciente_id, lead_id, presupuesto_id, nombre_perfil,
               (autor = 'agente' or sugerido_por_ia is true) as del_agente
          from mensajes_whatsapp
         where telefono is not null and "timestamp" is not null
         order by telefono, "timestamp" desc
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
      -- El nombre, resuelto en la misma pasada. El orden es el de fiabilidad:
      -- un paciente fichado manda sobre un lead, y los dos sobre el nombre que
      -- la persona se haya puesto en WhatsApp.
      nombre as (
        select u.telefono,
               coalesce(pa.nombre, l.nombre, nullif(u.nombre_perfil, '')) as nom,
               case when pa.nombre is not null then 'paciente'
                    when l.nombre  is not null then 'lead'
                    when nullif(u.nombre_perfil, '') is not null then 'perfil'
                    else 'telefono' end as origen
          from ultimo u
          left join pacientes pa on pa.cliente = ${cliente} and pa.id = u.paciente_id
          left join leads     l  on l.cliente  = ${cliente} and l.id  = u.lead_id
      )
      select u.telefono, u.contenido, u.direccion, u."timestamp", u.clinica_id,
             u.paciente_id, u.lead_id, u.presupuesto_id, u.del_agente,
             coalesce(p.n, 0) as pendientes,
             n.nom, n.origen,
             c.nombre as clinica_nombre,
             coalesce(pr.requiere_persona, false) as necesita_persona
        from ultimo u
        left join pend p on p.telefono = u.telefono
        left join nombre n on n.telefono = u.telefono
        left join clinicas c on c.cliente = ${cliente} and c.id = u.clinica_id
        left join presupuestos pr on pr.cliente = ${cliente} and pr.id = u.presupuesto_id
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
