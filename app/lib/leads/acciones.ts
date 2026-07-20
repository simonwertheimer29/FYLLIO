// app/lib/leads/acciones.ts
//
// Sprint 10 C — log estructurado de acciones sobre leads. Es la base del
// KPI "tiempo medio de respuesta" en Actuar Hoy + auditoría.
//
// Decisiones cerradas con Simon:
//  - Usuario apunta a Usuarios. Para acciones del webhook entrante, queda
//    vacío (campo opcional).
//  - KPI = tiempo entre WhatsApp_Entrante y siguiente WhatsApp_Saliente
//    del MISMO lead (ignoramos "mismo coord" en MVP — los leads no tienen
//    coord asignado).
//  - Solo going-forward. KPI muestra "—" hasta que haya datos.

import { base, TABLES, fetchAll } from "../airtable";

export type TipoAccionLead =
  | "Llamada"
  | "WhatsApp_Saliente"
  | "WhatsApp_Entrante"
  | "Cambio_Estado"
  | "Nota";

export type AccionLead = {
  id: string;
  leadId: string;
  tipo: TipoAccionLead;
  timestamp: string;
  usuarioId?: string;
  detalles?: string;
};

/**
 * Inserta una entrada en Acciones_Lead. Fire-and-forget en los callers:
 * los errores se loguean y se silencian para no romper el flujo principal.
 */
export async function logAccionLead(args: {
  leadId: string;
  tipo: TipoAccionLead;
  usuarioId?: string;
  detalles?: string;
  /** Override timestamp (por defecto = now). El webhook lo usa para honrar el ts del mensaje original. */
  timestamp?: string;
}): Promise<void> {
  try {
    const ts = args.timestamp ?? new Date().toISOString();
    const tsHumano = ts.replace("T", " ").slice(0, 16);
    const fields: Record<string, unknown> = {
      Resumen: `${args.tipo} · ${tsHumano}`,
      Lead: [args.leadId],
      Tipo_Accion: args.tipo,
      Timestamp: ts,
    };
    // NO escribimos el link `Usuario`: post-Sprint-B session.userId es un id de
    // la base CENTRAL de identidad, y Acciones_Lead (base de negocio) solo puede
    // enlazar usuarios de su propia base → el link es inválido y hacía FALLAR el
    // create entero (silenciado por el catch), así que la acción no se registraba
    // (rompía el KPI de tiempo medio y el estado "esperando respuesta"). El campo
    // no lo consume ningún KPI.
    if (args.detalles) fields.Detalles = args.detalles;
    await base(TABLES.accionesLead as any).create([{ fields } as any]);
  } catch (err) {
    console.error(
      "[acciones-lead] error logging:",
      err instanceof Error ? err.message : err,
    );
  }
}

function toAccionLead(rec: any): AccionLead {
  const f = rec.fields ?? {};
  const leadLinks = (f["Lead"] ?? []) as string[];
  const usuarioLinks = (f["Usuario"] ?? []) as string[];
  return {
    id: rec.id,
    leadId: leadLinks[0] ?? "",
    tipo: String(f["Tipo_Accion"] ?? "Nota") as TipoAccionLead,
    timestamp: String(f["Timestamp"] ?? rec._rawJson?.createdTime ?? rec.createdTime ?? ""),
    usuarioId: usuarioLinks[0],
    detalles: f["Detalles"] ? String(f["Detalles"]) : undefined,
  };
}

/**
 * Núcleo compartido: acciones con Timestamp posterior a `desdeIso`,
 * opcionalmente filtradas por clínicas accesibles (cruza leadId→clinicaId
 * con un select compacto porque Acciones_Lead.Lead es un link).
 */
async function listAccionesDesdeIso(
  desdeIso: string,
  clinicaIdsAllowed?: string[] | null,
): Promise<AccionLead[]> {
  const formula = `IS_AFTER({Timestamp}, '${desdeIso}')`;
  try {
    const recs = await fetchAll(
      base(TABLES.accionesLead as any).select({ filterByFormula: formula }),
    );
    let acciones = recs.map(toAccionLead);
    if (clinicaIdsAllowed && clinicaIdsAllowed.length > 0) {
      const leadIds = Array.from(new Set(acciones.map((a) => a.leadId).filter(Boolean)));
      if (leadIds.length === 0) return [];
      const allowed = new Set(clinicaIdsAllowed);
      const formulaLeads = `OR(${leadIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const leadRecs = await fetchAll(
        base(TABLES.leads as any).select({
          filterByFormula: formulaLeads,
          fields: ["Clinica"],
        }),
      );
      const leadToClinica = new Map<string, string>();
      for (const r of leadRecs) {
        const c = (r.fields as any)?.["Clinica"];
        if (Array.isArray(c) && c[0]) leadToClinica.set(r.id, String(c[0]));
      }
      acciones = acciones.filter((a) => {
        const cli = leadToClinica.get(a.leadId);
        return cli && allowed.has(cli);
      });
    }
    return acciones;
  } catch (err) {
    console.error(
      "[acciones-lead] listAccionesDesde error:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Lista acciones del día actual (zona Europe/Madrid) opcionalmente filtradas
 * por clínicas accesibles. Usado por el KPI tiempo medio de respuesta.
 */
export async function listAccionesHoy(params: {
  /** Si se pasa, solo devuelve acciones cuyo lead tenga clinicaId en la lista. */
  clinicaIdsAllowed?: string[] | null;
} = {}): Promise<AccionLead[]> {
  // Hoy en Madrid: tomamos UTC offset y devolvemos rango [00:00, 23:59].
  const today = new Date().toISOString().slice(0, 10);
  return listAccionesDesdeIso(`${today}T00:00:00.000Z`, params.clinicaIdsAllowed);
}

/** Acciones posteriores a `desde` (KPIs de leads por periodo). */
export async function listAccionesDesde(
  desde: Date,
  clinicaIdsAllowed?: string[] | null,
): Promise<AccionLead[]> {
  return listAccionesDesdeIso(desde.toISOString(), clinicaIdsAllowed);
}

/**
 * Últimos timestamps por lead y dirección: saliente (Llamada o
 * WhatsApp_Saliente) y entrante (WhatsApp_Entrante). Base del estado
 * derivado "esperando respuesta" en Actuar Hoy.
 */
export async function ultimasAccionesDireccionPorLead(): Promise<{
  salientePorLead: Record<string, string>;
  entrantePorLead: Record<string, string>;
}> {
  const recs = await fetchAll(
    base(TABLES.accionesLead as any).select({
      filterByFormula: `OR({Tipo_Accion}='Llamada', {Tipo_Accion}='WhatsApp_Saliente', {Tipo_Accion}='WhatsApp_Entrante')`,
      fields: ["Lead", "Timestamp", "Tipo_Accion"],
    }),
  );
  const salientePorLead: Record<string, string> = {};
  const entrantePorLead: Record<string, string> = {};
  for (const r of recs) {
    const f = r.fields as any;
    const links = (f["Lead"] ?? []) as string[];
    const lid = links[0];
    if (!lid) continue;
    const ts = String(
      f["Timestamp"] ?? (r as any)._rawJson?.createdTime ?? (r as any).createdTime ?? "",
    );
    if (!ts) continue;
    const map = f["Tipo_Accion"] === "WhatsApp_Entrante" ? entrantePorLead : salientePorLead;
    const prev = map[lid];
    if (!prev || ts > prev) map[lid] = ts;
  }
  return { salientePorLead, entrantePorLead };
}

/**
 * Acciones de un lead, más recientes primero. Carga la tabla con campos
 * mínimos y filtra en JS (el link Lead no es filtrable por record id sin
 * ARRAYJOIN sobre el primary field; volumen por tabla es bajo).
 */
export async function listAccionesByLead(leadId: string): Promise<AccionLead[]> {
  const recs = await fetchAll(
    base(TABLES.accionesLead as any).select({
      fields: ["Lead", "Tipo_Accion", "Timestamp", "Usuario", "Detalles"],
    }),
  );
  return recs
    .filter((r) => {
      const links = ((r.fields as any)?.["Lead"] ?? []) as string[];
      return links[0] === leadId;
    })
    .map(toAccionLead)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Última acción de cobranza por lead (Detalles empieza por '[Cobranza]',
 * escrito por marcar-contactado y agendar_llamada_cobranza). Map
 * leadId → ISO timestamp más reciente.
 */
export async function ultimaCobranzaPorLead(): Promise<Map<string, string>> {
  const recs = await fetchAll(
    base(TABLES.accionesLead as any).select({
      filterByFormula: `FIND('[Cobranza]', {Detalles}&'')>0`,
      fields: ["Lead", "Timestamp"],
    }),
  );
  const out = new Map<string, string>();
  for (const r of recs) {
    const f = r.fields as any;
    const links = (f["Lead"] ?? []) as string[];
    const lid = links[0];
    if (!lid) continue;
    const ts = String(f["Timestamp"] ?? "");
    if (!ts) continue;
    const prev = out.get(lid);
    if (!prev || ts > prev) out.set(lid, ts);
  }
  return out;
}

/** Timestamp del primer Acciones_Lead registrado (tooltip explicativo de
 *  KPIs). null si la tabla está vacía o inaccesible. */
export async function primeraAccionLeadTimestamp(): Promise<string | null> {
  try {
    const primero = await fetchAll(
      base(TABLES.accionesLead as any).select({
        sort: [{ field: "Timestamp", direction: "asc" }],
        maxRecords: 1,
        fields: ["Timestamp"],
      }),
    );
    return primero[0] ? String((primero[0].fields as any)?.["Timestamp"] ?? "") : null;
  } catch {
    return null;
  }
}

/**
 * Registro que usa la acción `crear_accion_lead` del motor de reglas.
 * OJO: escribe los campos `Tipo`/`Descripcion` (así lo hacía el motor desde
 * Sprint 16b), NO `Tipo_Accion`/`Detalles` como `logAccionLead`. Se preserva
 * tal cual en FASE 1 (paridad); unificar es un follow-up, no parte de la
 * migración.
 */
export async function crearAccionAutomatizacion(input: {
  leadId: string;
  tipo: string;
  descripcion: string;
}): Promise<void> {
  await base(TABLES.accionesLead).create(
    [
      {
        fields: {
          Lead: [input.leadId],
          Tipo: input.tipo,
          Descripcion: input.descripcion,
          Timestamp: new Date().toISOString(),
        },
      },
    ],
    { typecast: true },
  );
}

/**
 * KPI tiempo medio de respuesta. Para cada lead que tuvo WhatsApp_Entrante
 * hoy, calcula minutos entre ese entrante y el siguiente WhatsApp_Saliente
 * del mismo lead (cualquier coord). Promedio de todos los pares.
 *
 * Devuelve null si no hay pares todavía (UI mostrará "—").
 */
export function tiempoMedioRespuestaMin(acciones: AccionLead[]): number | null {
  // Agrupar por lead.
  const porLead = new Map<string, AccionLead[]>();
  for (const a of acciones) {
    if (!a.leadId) continue;
    if (!porLead.has(a.leadId)) porLead.set(a.leadId, []);
    porLead.get(a.leadId)!.push(a);
  }

  const diffs: number[] = [];
  for (const list of porLead.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    // Para cada entrante sin saliente posterior emparejado, busca el
    // primer saliente que venga después y registra la diferencia. No
    // emparejamos el mismo entrante dos veces.
    let i = 0;
    while (i < list.length) {
      const a = list[i]!;
      if (a.tipo === "WhatsApp_Entrante") {
        const next = list.slice(i + 1).find((x) => x.tipo === "WhatsApp_Saliente");
        if (next) {
          const dt =
            (new Date(next.timestamp).getTime() - new Date(a.timestamp).getTime()) /
            (1000 * 60);
          if (dt >= 0) diffs.push(dt);
        }
      }
      i++;
    }
  }

  if (diffs.length === 0) return null;
  const avg = diffs.reduce((s, n) => s + n, 0) / diffs.length;
  return Math.round(avg);
}
