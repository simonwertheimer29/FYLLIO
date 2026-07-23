// Una sola fuente de verdad del dinero por paciente (decisión 2026-07-23).
//
//   FIRMADO   = Σ importe de presupuestos ACEPTADO      → tabla presupuestos
//   COBRADO   = Σ pagos reales                          → tabla pagos_paciente
//   PENDIENTE = max(0, firmado − cobrado)
//   ACEPTADO  = derivado de presupuestos: algún ACEPTADO → "Si";
//               alguno vivo (ni aceptado ni perdido) → "Pendiente";
//               solo perdidos → "No"; sin presupuestos → null.
//
// Los campos de la tabla pacientes (aceptado, presupuesto_total, pagado,
// pendiente) dejan de ser fuente de PANTALLA: `aceptado` era un select manual
// que divergía de los presupuestos reales, y `pagado`/`pendiente` son cache de
// sincronización (se mantienen escritos por compatibilidad con el resto del
// sistema, pero lo que se muestra sale de aquí). Antes convivían cuatro cifras
// para "facturado"; ahora cada concepto tiene una fuente.
//
// Server-only (usa los repos). Corre dentro del contexto de cliente
// (runWithCliente) del caller, como todos los repos.

import { selectPresupuestosRaw } from "./presupuestos/repo";
import { listPagosResumen } from "./pagos";

export type FinanzasPaciente = {
  firmado: number;
  cobrado: number;
  pendiente: number;
  aceptado: "Si" | "No" | "Pendiente" | null;
  /** Bloque 3 (D2): tratamientos DERIVADOS de sus presupuestos no perdidos —
   *  la columna propia pacientes.tratamientos queda como copia a deprecar. */
  tratamientos: string[];
};

type Acc = { firmado: number; cobrado: number; aceptados: number; perdidos: number; vivos: number; tratamientos: Set<string> };

/**
 * Finanzas derivadas de TODOS los pacientes del cliente en 2 queries
 * (presupuestos + pagos), agrupadas por paciente. El link Presupuestos.Paciente
 * se resuelve con load+filter JS (mismo patrón que la ficha: el ARRAYJOIN de
 * Airtable devolvía primary field en vez de ids; el shim de PG conserva el
 * shape). Volumen MVP: cientos de filas.
 */
export async function finanzasPorPaciente(): Promise<Map<string, FinanzasPaciente>> {
  const [presus, pagos] = await Promise.all([
    selectPresupuestosRaw({ fields: ["Paciente", "Estado", "Importe", "Tratamiento_nombre"] }),
    listPagosResumen(),
  ]);

  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { firmado: 0, cobrado: 0, aceptados: 0, perdidos: 0, vivos: 0, tratamientos: new Set() };
      acc.set(id, a);
    }
    return a;
  };

  for (const r of presus) {
    const links = ((r.fields as Record<string, unknown>)?.["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    if (!pid) continue;
    const f = r.fields as Record<string, unknown>;
    const estado = String(f["Estado"] ?? "");
    const importe = Number(f["Importe"] ?? 0) || 0;
    const a = get(pid);
    if (estado !== "PERDIDO") {
      for (const t of String(f["Tratamiento_nombre"] ?? "").split(/[,+]/)) {
        const limpio = t.trim();
        if (limpio) a.tratamientos.add(limpio);
      }
    }
    if (estado === "ACEPTADO") {
      a.aceptados++;
      a.firmado += importe;
    } else if (estado === "PERDIDO") {
      a.perdidos++;
    } else {
      a.vivos++;
    }
  }

  for (const p of pagos) {
    if (!p.pacienteRecordId) continue;
    get(p.pacienteRecordId).cobrado += p.importe;
  }

  const out = new Map<string, FinanzasPaciente>();
  for (const [pid, a] of acc) {
    out.set(pid, {
      firmado: a.firmado,
      cobrado: a.cobrado,
      pendiente: Math.max(0, a.firmado - a.cobrado),
      aceptado:
        a.aceptados > 0 ? "Si" : a.vivos > 0 ? "Pendiente" : a.perdidos > 0 ? "No" : null,
      tratamientos: [...a.tratamientos],
    });
  }
  return out;
}

const SIN_PRESUPUESTOS: FinanzasPaciente = {
  firmado: 0,
  cobrado: 0,
  pendiente: 0,
  aceptado: null,
  tratamientos: [],
};

/** Finanzas de un solo paciente (misma derivación; para las rutas de ficha). */
export async function finanzasDePaciente(pacienteId: string): Promise<FinanzasPaciente> {
  const map = await finanzasPorPaciente();
  return map.get(pacienteId) ?? { ...SIN_PRESUPUESTOS };
}
