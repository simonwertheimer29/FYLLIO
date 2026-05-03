// app/lib/alertas/calcular.ts
// Sprint 8 D.7 — cálculo de situaciones por clínica y tipo.
// Se ejecuta en cada GET /api/alertas. No cron (Sprint 9).

import { base, TABLES, fetchAll } from "../airtable";
import { listAllOpciones } from "../configuraciones/configuraciones";
import type { TipoAlerta } from "./templates";

export type AlertaClinica = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<TipoAlerta, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function calcularAlertas(): Promise<AlertaClinica[]> {
  const [clinicas, leads, presupuestos, colaEnvios, pagos, pacientes, opciones] =
    await Promise.all([
      fetchAll(base(TABLES.clinics).select({ filterByFormula: "{Activa}" })),
      fetchAll(base(TABLES.leads).select({})),
      fetchAll(base(TABLES.presupuestos).select({})),
      fetchAll(base(TABLES.colaEnvios).select({ filterByFormula: "{Estado}='Fallido'" })),
      // Sprint 14b Bloque 3 — pagos all-time + pacientes + plazos config
      // para los 3 triggers de cobros.
      fetchAll(
        base(TABLES.pagosPaciente as any).select({
          fields: ["Paciente_RecordId", "Tipo"],
        }),
      ),
      fetchAll(
        base(TABLES.patients as any).select({
          fields: [
            "Nombre",
            "Clínica",
            "Aceptado",
            "Presupuesto_Total",
          ],
        }),
      ),
      listAllOpciones(),
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
      result.set(clinicaId, {
        leads: 0,
        presupuestos: 0,
        citados: 0,
        asistencias: 0,
        automatizaciones: 0,
        cobro_vence_3d: 0,
        cobro_vencido_7d: 0,
        pendiente_alto_estancado: 0,
      });
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
    const ct = r._rawJson?.createdTime ?? r.createdTime;
    const created = ct ? new Date(ct).getTime() : 0;
    if (!created || now - created < DAY_MS) continue;
    const clis = (f["Clinica"] ?? []) as string[];
    if (clis[0]) add(clis[0], "leads");
  }

  // 2. ASISTENCIAS sin cerrar (Sprint 9 G.6) — leads con cita pasada o de hoy
  //    en estado Citado/Citados Hoy, sin marcar Asistido ni transicionar a
  //    No Interesado/Convertido. Incluye "Citado" porque en Sprint 9 G.7
  //    "Citados Hoy" deja de ser un estado real (solo filtro visual); los
  //    nuevos leads quedan en "Citado" con Fecha_Cita.
  for (const r of leads) {
    const f = r.fields ?? {};
    const estado = String(f["Estado"] ?? "");
    if (estado !== "Citado" && estado !== "Citados Hoy") continue;
    const fecha = f["Fecha_Cita"] ? String(f["Fecha_Cita"]) : "";
    if (!fecha || fecha > today) continue; // futuras no aplican
    if (f["Asistido"]) continue;
    const clis = (f["Clinica"] ?? []) as string[];
    if (clis[0]) add(clis[0], "asistencias");
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

  // ── Sprint 14b Bloque 3 — triggers de cobros ──────────────────────
  //
  // 5. cobro_vence_3d:        Aceptado=Si + (Fecha_Aceptado + plazo) entre
  //                            hoy y hoy+3d, sin pago tipo Liquidacion.
  // 6. cobro_vencido_7d:      Aceptado=Si + (Fecha_Aceptado + plazo + 7d) <
  //                            hoy, sin pago tipo Liquidacion.
  // 7. pendiente_alto_estancado: presupuesto > 2000€ + Aceptado hace >30d +
  //                            sin pago registrado de ningún tipo.
  //
  // Plazo por clínica (Configuraciones_Clinica.Plazos_Liquidacion) con
  // fallback a global (default 90).
  const plazoPorClinica = new Map<string | null, number>();
  for (const o of opciones) {
    if (o.categoria !== "Plazos_Liquidacion" || !o.activo) continue;
    const n = Number(o.valor);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!plazoPorClinica.has(o.clinicaId)) plazoPorClinica.set(o.clinicaId, n);
  }
  const plazoGlobal = plazoPorClinica.get(null) ?? 90;
  const plazoFor = (clinicaId: string | null): number =>
    clinicaId && plazoPorClinica.has(clinicaId)
      ? plazoPorClinica.get(clinicaId)!
      : plazoGlobal;

  // Mapas auxiliares: pagos por paciente (cuántos + tieneLiquidacion).
  const pagosCountPorPaciente = new Map<string, number>();
  const tieneLiquidacionPorPaciente = new Set<string>();
  for (const r of pagos) {
    const f = r.fields as any;
    const pid = String(f["Paciente_RecordId"] ?? "");
    if (!pid) continue;
    pagosCountPorPaciente.set(pid, (pagosCountPorPaciente.get(pid) ?? 0) + 1);
    if (String(f["Tipo"] ?? "") === "Liquidacion") {
      tieneLiquidacionPorPaciente.add(pid);
    }
  }

  // Map paciente.id → primera Fecha_Aceptado de presupuestos ACEPTADO de
  // ese paciente (para los 3 triggers de cobros).
  const fechaAceptadoPorPaciente = new Map<string, string>();
  const importeAceptadoPorPaciente = new Map<string, number>();
  for (const r of presupuestos) {
    const f = r.fields ?? {};
    if (String(f["Estado"] ?? "") !== "ACEPTADO") continue;
    const links = (f["Paciente"] ?? []) as string[];
    const pid = links[0];
    if (!pid) continue;
    const fecha = String(f["Fecha_Aceptado"] ?? f["FechaAlta"] ?? "").slice(0, 10);
    if (fecha) {
      const prev = fechaAceptadoPorPaciente.get(pid);
      if (!prev || fecha < prev) fechaAceptadoPorPaciente.set(pid, fecha);
    }
    const importe = Number(f["Importe"] ?? 0) || 0;
    importeAceptadoPorPaciente.set(
      pid,
      (importeAceptadoPorPaciente.get(pid) ?? 0) + importe,
    );
  }

  const HOY_MS = now;
  const VENCE_3D_MS = HOY_MS + 3 * DAY_MS;
  const VENCIDO_7D_OFFSET = 7 * DAY_MS;
  const ESTANCADO_DAYS = 30 * DAY_MS;
  const ESTANCADO_IMPORTE_MIN = 2000;

  // Iteramos sobre pacientes pero la fuente de verdad para "aceptado" es
  // tener un Presupuesto en Estado=ACEPTADO (los campos
  // Pacientes.Aceptado y Presupuestos.Estado=ACEPTADO son independientes;
  // los seed legacy a veces tienen el flag de paciente desincronizado).
  // Considera al paciente alertable si EL O presupuesto tiene Estado=
  // ACEPTADO O el flag Aceptado=Si está marcado (cubre ambos seeds).
  for (const r of pacientes) {
    const f = r.fields as any;
    const tienePresupAceptado = fechaAceptadoPorPaciente.has(r.id);
    const flagAceptado = f["Aceptado"] === "Si";
    if (!tienePresupAceptado && !flagAceptado) continue;
    const presupuestoTotal =
      typeof f["Presupuesto_Total"] === "number"
        ? Number(f["Presupuesto_Total"])
        : importeAceptadoPorPaciente.get(r.id) ?? 0;
    if (!presupuestoTotal || presupuestoTotal <= 0) continue;
    const clinicaLinks = (f["Clínica"] ?? []) as string[];
    const cid = clinicaLinks[0];
    if (!cid || !clinicaById.has(cid)) continue;

    // Fecha aceptado: prioridad al Fecha_Aceptado del presupuesto
    // ACEPTADO; fallback al createdTime del paciente.
    const fechaAceptado =
      fechaAceptadoPorPaciente.get(r.id) ??
      String(r._rawJson?.createdTime ?? "").slice(0, 10);
    const aceptadoMs = fechaAceptado
      ? new Date(fechaAceptado).getTime()
      : null;
    const tieneLiquidacion = tieneLiquidacionPorPaciente.has(r.id);
    const tieneAlgunPago = (pagosCountPorPaciente.get(r.id) ?? 0) > 0;

    if (aceptadoMs && Number.isFinite(aceptadoMs)) {
      const venceMs = aceptadoMs + plazoFor(cid) * DAY_MS;

      // Trigger 1: cobro_vence_3d (rango [hoy, hoy+3d]).
      if (
        venceMs >= HOY_MS &&
        venceMs <= VENCE_3D_MS &&
        !tieneLiquidacion
      ) {
        add(cid, "cobro_vence_3d");
      }

      // Trigger 2: cobro_vencido_7d (vencido hace > 7 días).
      if (
        HOY_MS - venceMs > VENCIDO_7D_OFFSET &&
        !tieneLiquidacion
      ) {
        add(cid, "cobro_vencido_7d");
      }
    }

    // Trigger 3: pendiente_alto_estancado (presupuesto >2000 +
    // Aceptado hace >30d + sin NINGÚN pago).
    if (
      presupuestoTotal > ESTANCADO_IMPORTE_MIN &&
      aceptadoMs &&
      HOY_MS - aceptadoMs > ESTANCADO_DAYS &&
      !tieneAlgunPago
    ) {
      add(cid, "pendiente_alto_estancado");
    }
  }

  const totalOf = (c: Record<TipoAlerta, number>) =>
    c.leads +
    c.presupuestos +
    c.citados +
    c.asistencias +
    c.automatizaciones +
    c.cobro_vence_3d +
    c.cobro_vencido_7d +
    c.pendiente_alto_estancado;

  const out: AlertaClinica[] = [];
  for (const [clinicaId, counts] of result) {
    if (totalOf(counts) === 0) continue;
    out.push({
      clinicaId,
      clinicaNombre: clinicaById.get(clinicaId)?.nombre ?? "",
      counts,
    });
  }
  out.sort((a, b) => totalOf(b.counts) - totalOf(a.counts));
  return out;
}
