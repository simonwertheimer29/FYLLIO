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
    if (args.usuarioId) fields.Usuario = [args.usuarioId];
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
    timestamp: String(f["Timestamp"] ?? rec.createdTime ?? ""),
    usuarioId: usuarioLinks[0],
    detalles: f["Detalles"] ? String(f["Detalles"]) : undefined,
  };
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
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const formula = `IS_AFTER({Timestamp}, '${today}T00:00:00.000Z')`;
  try {
    const recs = await fetchAll(
      base(TABLES.accionesLead as any).select({ filterByFormula: formula }),
    );
    let acciones = recs.map(toAccionLead);
    if (params.clinicaIdsAllowed && params.clinicaIdsAllowed.length > 0) {
      // Necesitamos cruzar leadId → clinicaId. Lo hacemos con un select compacto.
      const leadIds = Array.from(new Set(acciones.map((a) => a.leadId).filter(Boolean)));
      if (leadIds.length === 0) return [];
      const allowed = new Set(params.clinicaIdsAllowed);
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
      "[acciones-lead] listAccionesHoy error:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
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
