// app/lib/alertas/calcular.ts
// Sprint 8 D.7 — cálculo de situaciones por clínica y tipo.
// Se ejecuta en cada GET /api/alertas. No cron (Sprint 9).

import { base, TABLES, fetchAll } from "../airtable";
import type { TipoAlerta } from "./templates";

export type AlertaClinica = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<TipoAlerta, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function calcularAlertas(): Promise<AlertaClinica[]> {
  const [clinicas, leads, presupuestos, colaEnvios] = await Promise.all([
    fetchAll(base(TABLES.clinics).select({ filterByFormula: "{Activa}" })),
    fetchAll(base(TABLES.leads).select({})),
    fetchAll(base(TABLES.presupuestos).select({})),
    fetchAll(base(TABLES.colaEnvios).select({ filterByFormula: "{Estado}='Fallido'" })),
  ]);

  const clinicaById = new Map<string, { nombre: string }>();
  for (const c of clinicas) {
    clinicaById.set(c.id, { nombre: String(c.fields?.["Nombre"] ?? "") });
  }

  // Mapas temporales
  const result = new Map<string, Record<TipoAlerta, number>>();
  function add(clinicaId: string, tipo: TipoAlerta, n = 1): void {
    if (!clinicaId || !clinicaById.has(clinicaId)) return;
    if (!result.has(clinicaId)) {
      result.set(clinicaId, { leads: 0, presupuestos: 0, citados: 0, automatizaciones: 0 });
    }
    result.get(clinicaId)![tipo] += n;
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // 1. LEADS sin gestionar: Estado=Nuevo + Fecha_Creacion >24h + Llamado=false + WhatsApp_Enviados=0
  for (const r of leads) {
    const f = r.fields ?? {};
    if (f["Estado"] !== "Nuevo") continue;
    if (f["Llamado"]) continue;
    if (Number(f["WhatsApp_Enviados"] ?? 0) > 0) continue;
    const created = r.createdTime ? new Date(r.createdTime).getTime() : 0;
    if (!created || now - created < DAY_MS) continue;
    const clis = (f["Clinica"] ?? []) as string[];
    if (clis[0]) add(clis[0], "leads");
  }

  // 2. CITADOS no asistidos: Estado=Citados Hoy + Fecha_Cita < hoy + Asistido=false
  for (const r of leads) {
    const f = r.fields ?? {};
    if (f["Estado"] !== "Citados Hoy") continue;
    const fecha = f["Fecha_Cita"] ? String(f["Fecha_Cita"]) : "";
    if (!fecha || fecha >= today) continue;
    if (f["Asistido"]) continue;
    const clis = (f["Clinica"] ?? []) as string[];
    if (clis[0]) add(clis[0], "citados");
  }

  // 3. PRESUPUESTOS sin seguimiento: Estado ∈ {PRESENTADO, INTERESADO, EN_DUDA}
  //    + Ultima_accion_registrada vacío o <now-48h. Clínica por nombre (field text).
  const clinicaByNombre = new Map<string, string>(); // nombre → id
  for (const [id, info] of clinicaById) clinicaByNombre.set(info.nombre, id);
  const THRESHOLD_48H = now - 2 * DAY_MS;

  for (const r of presupuestos) {
    const f = r.fields ?? {};
    const estado = String(f["Estado"] ?? "");
    if (estado !== "PRESENTADO" && estado !== "INTERESADO" && estado !== "EN_DUDA") continue;
    const last = f["Ultima_accion_registrada"] ? new Date(String(f["Ultima_accion_registrada"])).getTime() : 0;
    if (last && last >= THRESHOLD_48H) continue;
    const clinicaNombre = String(f["Clinica"] ?? "");
    const clinicaId = clinicaByNombre.get(clinicaNombre);
    if (clinicaId) add(clinicaId, "presupuestos");
  }

  // 4. AUTOMATIZACIONES con error: Cola_Envios con Estado=Fallido.
  //    El presupuesto linkea por ID (text). Buscamos su clínica.
  const presupAirtableIdToClinica = new Map<string, string>();
  for (const r of presupuestos) {
    const nombreClinica = String(r.fields?.["Clinica"] ?? "");
    const cid = clinicaByNombre.get(nombreClinica);
    if (cid) presupAirtableIdToClinica.set(r.id, cid);
  }
  // También permitimos que 'Presupuesto' en Cola_Envios sea el 'Presupuesto ID' string.
  const presupBusinessIdToClinica = new Map<string, string>();
  for (const r of presupuestos) {
    const pid = String(r.fields?.["Presupuesto ID"] ?? "");
    const nombreClinica = String(r.fields?.["Clinica"] ?? "");
    const cid = clinicaByNombre.get(nombreClinica);
    if (pid && cid) presupBusinessIdToClinica.set(pid, cid);
  }
  for (const r of colaEnvios) {
    const presupRef = String(r.fields?.["Presupuesto"] ?? "");
    if (!presupRef) continue;
    const cid =
      presupAirtableIdToClinica.get(presupRef) ?? presupBusinessIdToClinica.get(presupRef);
    if (cid) add(cid, "automatizaciones");
  }

  const out: AlertaClinica[] = [];
  for (const [clinicaId, counts] of result) {
    const totals = counts.leads + counts.presupuestos + counts.citados + counts.automatizaciones;
    if (totals === 0) continue;
    out.push({
      clinicaId,
      clinicaNombre: clinicaById.get(clinicaId)?.nombre ?? "",
      counts,
    });
  }
  // Ordenar por total desc
  out.sort(
    (a, b) =>
      (b.counts.leads + b.counts.presupuestos + b.counts.citados + b.counts.automatizaciones) -
      (a.counts.leads + a.counts.presupuestos + a.counts.citados + a.counts.automatizaciones)
  );
  return out;
}
