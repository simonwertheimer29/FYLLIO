// UNA derivación de la situación de cobro por paciente (Bloque 2, 2026-07-23).
//
// Antes vivía inline en /api/cola-cobros y PREFERÍA las cachés del paciente
// (presupuesto_total, aceptado) sobre los registros reales — las columnas en
// deprecación de MEJORAS nº 28. Extraída aquí como derivación PURA:
//   FIRMADO   = Σ presupuestos ACEPTADO del paciente
//   PAGADO    = Σ pagos reales
//   PENDIENTE = firmado − pagado (solo entra en cola si > 0)
//   VENCIDO   = fecha_aceptado + plazo de su clínica (config
//               Plazos_Liquidacion, fallback 90 días) superado en >7 días
//               sin pago de liquidación.
// La consumen la cola de cobros (/api/cola-cobros) y el dashboard de Red —
// la misma función, cero cálculo paralelo.

const DAY_MS = 24 * 60 * 60 * 1000;

export type UrgenciaCobro = "vencido" | "por_vencer" | "estancado" | "normal";

export type CobroPaciente = {
  pacienteId: string;
  clinicaId: string | null;
  firmado: number;
  pagado: number;
  pendiente: number;
  fechaAceptado: string | null;
  diasDesdeAceptacion: number | null;
  plazoDias: number;
  diasVencido: number | null; // positivo = vencido hace N
  diasParaVencer: number | null; // positivo = vence en N
  urgencia: UrgenciaCobro;
  numPagos: number;
};

export function calcularCobrosPorPaciente(args: {
  pacientes: ReadonlyArray<{ id: string; clinicaId: string | null }>;
  /** Records crudos de presupuestos con Paciente/Estado/Importe/Fecha_Aceptado/FechaAlta. */
  presupuestos: ReadonlyArray<{ id: string; fields: Record<string, unknown> }>;
  pagos: ReadonlyArray<{ pacienteRecordId: string | null; importe: number; tipo?: string | null }>;
  /** Opciones de configuración (categoría Plazos_Liquidacion). */
  opciones: ReadonlyArray<{ categoria: string; valor: string; activo: boolean; clinicaId: string | null }>;
  ahoraMs?: number;
}): CobroPaciente[] {
  const today = args.ahoraMs ?? Date.now();

  // Plazos por clínica (config) con fallback global.
  const plazoPorClinica = new Map<string | null, number>();
  for (const o of args.opciones) {
    if (o.categoria !== "Plazos_Liquidacion" || !o.activo) continue;
    const n = Number(o.valor);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!plazoPorClinica.has(o.clinicaId)) plazoPorClinica.set(o.clinicaId, n);
  }
  const plazoGlobal = plazoPorClinica.get(null) ?? 90;
  const plazoFor = (cid: string | null) =>
    cid && plazoPorClinica.has(cid) ? plazoPorClinica.get(cid)! : plazoGlobal;

  // Pagos por paciente.
  const pagadoPorPac = new Map<string, number>();
  const pagosCountPorPac = new Map<string, number>();
  const tieneLiquidacionPac = new Set<string>();
  for (const pago of args.pagos) {
    const pid = pago.pacienteRecordId;
    if (!pid) continue;
    pagadoPorPac.set(pid, (pagadoPorPac.get(pid) ?? 0) + pago.importe);
    pagosCountPorPac.set(pid, (pagosCountPorPac.get(pid) ?? 0) + 1);
    if (pago.tipo === "Liquidacion") tieneLiquidacionPac.add(pid);
  }

  // Presupuestos ACEPTADO: fecha mínima + firmado por paciente (los REGISTROS,
  // nunca las cachés del paciente).
  const fechaAceptadoMinPorPac = new Map<string, string>();
  const firmadoPorPac = new Map<string, number>();
  for (const r of args.presupuestos) {
    const f = r.fields;
    if (String(f["Estado"] ?? "") !== "ACEPTADO") continue;
    const links = (f["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    if (!pid) continue;
    const fecha = String(f["Fecha_Aceptado"] ?? f["FechaAlta"] ?? "").slice(0, 10);
    if (fecha) {
      const prev = fechaAceptadoMinPorPac.get(pid);
      if (!prev || fecha < prev) fechaAceptadoMinPorPac.set(pid, fecha);
    }
    firmadoPorPac.set(pid, (firmadoPorPac.get(pid) ?? 0) + (Number(f["Importe"] ?? 0) || 0));
  }

  const items: CobroPaciente[] = [];
  for (const p of args.pacientes) {
    const firmado = firmadoPorPac.get(p.id) ?? 0;
    if (firmado <= 0) continue;
    const pagado = pagadoPorPac.get(p.id) ?? 0;
    const pendiente = Math.max(0, firmado - pagado);
    if (pendiente <= 0) continue; // sin pendiente, no entra en cola.

    const fechaAceptado = fechaAceptadoMinPorPac.get(p.id) ?? null;
    const aceptadoMs = fechaAceptado ? new Date(fechaAceptado).getTime() : null;
    const plazoDias = plazoFor(p.clinicaId);
    const diasDesdeAceptacion = aceptadoMs
      ? Math.max(0, Math.floor((today - aceptadoMs) / DAY_MS))
      : null;

    let diasVencido: number | null = null;
    let diasParaVencer: number | null = null;
    let urgencia: UrgenciaCobro = "normal";
    if (aceptadoMs) {
      const venceMs = aceptadoMs + plazoDias * DAY_MS;
      if (venceMs < today) diasVencido = Math.floor((today - venceMs) / DAY_MS);
      else diasParaVencer = Math.floor((venceMs - today) / DAY_MS);
    }
    const tieneLiquidacion = tieneLiquidacionPac.has(p.id);
    const tieneAlgunPago = (pagosCountPorPac.get(p.id) ?? 0) > 0;

    if (diasVencido != null && diasVencido > 7 && !tieneLiquidacion) {
      urgencia = "vencido";
    } else if (diasParaVencer != null && diasParaVencer <= 7 && !tieneLiquidacion) {
      urgencia = "por_vencer";
    } else if (
      firmado > 2000 &&
      diasDesdeAceptacion != null &&
      diasDesdeAceptacion > 30 &&
      !tieneAlgunPago
    ) {
      urgencia = "estancado";
    }

    items.push({
      pacienteId: p.id,
      clinicaId: p.clinicaId,
      firmado,
      pagado,
      pendiente,
      fechaAceptado,
      diasDesdeAceptacion,
      plazoDias,
      diasVencido,
      diasParaVencer,
      urgencia,
      numPagos: pagosCountPorPac.get(p.id) ?? 0,
    });
  }
  return items;
}
