// app/lib/pagos.ts
//
// Sprint 13.1 Bloque 0 — helpers de la tabla Pagos_Paciente.
//
// Diseño:
//  - Cada Pago es un registro con Fecha_Pago real, Importe, Metodo y
//    Tipo. Soporta tandas, financiación y señales.
//  - Pacientes.Pagado se mantiene como CACHE total (Σ pagos del paciente)
//    para no romper código existente que lo lee directamente. Al
//    insertar un pago via crearPago(), también sumamos al campo
//    Pacientes.Pagado del paciente vinculado y restamos del Pendiente
//    si quedaba saldo.
//  - getFacturadoEnPeriodo() lee Pagos_Paciente directamente filtrando
//    por Fecha_Pago. Soporta filtro por clinica + soloOrigenLead.

import { base, TABLES, fetchAll } from "./airtable";
import {
  listResumenFinancieroPorIds,
  sumPendientePorIds,
  syncFinancieroPaciente,
} from "./pacientes/pacientes";
import type { MetodoPago, TipoPago, Pago } from "./pagos-format";

// Sprint B — los tipos y helpers PUROS (MetodoPago, TipoPago, Pago, TIPOS_PAGO,
// METODOS_PAGO, formatTipo) viven ahora en pagos-format.ts (sin dependencia de
// Airtable) para no arrastrar la capa de datos al bundle cliente. Se re-exportan
// aquí para que todo el código de servidor los siga importando desde pagos.ts.
export { TIPOS_PAGO, METODOS_PAGO, formatTipo } from "./pagos-format";
export type { MetodoPago, TipoPago, Pago } from "./pagos-format";

function toPago(rec: any): Pago {
  const f = rec.fields ?? {};
  const links = (f["Paciente_Link"] ?? []) as string[];
  const usuarios = (f["Usuario_Creador"] ?? []) as string[];
  // Sprint 14a — preferimos Paciente_RecordId (texto plano rellenado por
  // codigo) sobre Paciente_Link[0]. Ambos coinciden por contrato; el
  // texto plano es el que permite filterByFormula directo.
  const pacienteId = String(f["Paciente_RecordId"] ?? "") || links[0] || "";
  return {
    id: rec.id,
    pacienteId,
    fechaPago: String(f["Fecha_Pago"] ?? "").slice(0, 10),
    importe: Number(f["Importe"] ?? 0),
    metodo: (String(f["Metodo"] ?? "Otro") as MetodoPago),
    tipo: (String(f["Tipo"] ?? "Liquidacion") as TipoPago),
    nota: f["Nota"] ? String(f["Nota"]) : null,
    createdAt: String(rec._rawJson?.createdTime ?? rec.createdTime ?? ""),
    usuarioCreadorId: usuarios[0] ?? null,
  };
}

// ─── Lectura ──────────────────────────────────────────────────────────

export async function getPagosByPaciente(pacienteId: string): Promise<Pago[]> {
  if (!pacienteId) return [];
  // Sprint 14a — usa Paciente_RecordId (texto plano rellenado por
  // codigo) para filterByFormula directo. Reemplaza el workaround
  // load-all+filter-JS del Sprint 13.1.1, que se introdujo porque
  // ARRAYJOIN({Paciente_Link}) devuelve el primary field de Pacientes
  // ("PAT_NNN") en vez de record IDs.
  const formula = `{Paciente_RecordId} = '${pacienteId}'`;
  try {
    const recs = await fetchAll(
      base(TABLES.pagosPaciente as any).select({
        filterByFormula: formula,
        sort: [{ field: "Fecha_Pago", direction: "desc" }],
      }),
    );
    return recs.map(toPago);
  } catch (err) {
    console.error("[pagos] getPagosByPaciente:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Total facturado en un periodo, opcionalmente filtrado por clinica
 * (nombre, ya que Pacientes.Clinica es link → leemos el nombre desde
 * Pacientes) y por origen lead (Pacientes con Lead_Origen != null).
 *
 * Implementacion: leemos Pagos_Paciente del periodo filtrando por
 * Fecha_Pago. Si soloOrigenLead o clinicaId, hacemos un cruce a
 * Pacientes para resolver pertenencia. Para volúmenes pequeños es OK;
 * en cuanto haya >5k pagos vale la pena cachear (Bloque 4.8).
 */
export async function getFacturadoEnPeriodo(args: {
  desde: Date;
  hasta: Date;
  /** Filtra a pacientes con Lead_Origen presente (origen lead). */
  soloOrigenLead?: boolean;
  /** Filtra a una clinica concreta (record id de Clinicas). */
  clinicaId?: string;
}): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  const desdeISO = args.desde.toISOString().slice(0, 10);
  const hastaISO = args.hasta.toISOString().slice(0, 10);
  // Airtable IS_AFTER y IS_BEFORE son inclusivos por dia? Usamos rango
  // explícito IS_SAME_OR_AFTER + IS_SAME_OR_BEFORE.
  const formula = `AND(
    IS_AFTER({Fecha_Pago}, '${shiftDay(desdeISO, -1)}'),
    IS_BEFORE({Fecha_Pago}, '${shiftDay(hastaISO, 1)}')
  )`.replace(/\s+/g, " ");

  let pagos: Pago[];
  try {
    const recs = await fetchAll(
      base(TABLES.pagosPaciente as any).select({ filterByFormula: formula }),
    );
    pagos = recs.map(toPago);
  } catch (err) {
    console.error("[pagos] getFacturadoEnPeriodo:", err instanceof Error ? err.message : err);
    return { total: 0, pendiente: 0, pagosCount: 0 };
  }

  if (pagos.length === 0) {
    return { total: 0, pendiente: 0, pagosCount: 0 };
  }

  // Si no hay filtros adicionales, total = suma directa.
  if (!args.soloOrigenLead && !args.clinicaId) {
    const total = pagos.reduce((s, p) => s + p.importe, 0);
    const pacIds = Array.from(new Set(pagos.map((p) => p.pacienteId).filter(Boolean)));
    const pendiente = await getPendienteSum(pacIds);
    return { total, pendiente, pagosCount: pagos.length };
  }

  // Cruce con Pacientes para filtrar por clinica/origen lead.
  const pacIds = Array.from(new Set(pagos.map((p) => p.pacienteId).filter(Boolean)));
  if (pacIds.length === 0) return { total: 0, pendiente: 0, pagosCount: 0 };
  // FASE 1 migración: el cruce con Pacientes vive en el repo del dominio.
  let pacResumen: Awaited<ReturnType<typeof listResumenFinancieroPorIds>> = [];
  try {
    pacResumen = await listResumenFinancieroPorIds(pacIds);
  } catch (err) {
    console.error("[pagos] crossing pacientes:", err instanceof Error ? err.message : err);
    return { total: 0, pendiente: 0, pagosCount: 0 };
  }
  const pacAllowed = new Set<string>();
  let pendienteSum = 0;
  for (const p of pacResumen) {
    const ok =
      (!args.clinicaId || p.clinicaIds.includes(args.clinicaId)) &&
      (!args.soloOrigenLead || p.tieneLeadOrigen);
    if (ok) {
      pacAllowed.add(p.id);
      pendienteSum += p.pendiente;
    }
  }
  const filtrados = pagos.filter((p) => pacAllowed.has(p.pacienteId));
  const total = filtrados.reduce((s, p) => s + p.importe, 0);
  return { total, pendiente: pendienteSum, pagosCount: filtrados.length };
}

/**
 * Sprint 13.1.1 — facturado preciso filtrando Pagos_Paciente por una
 * lista concreta de pacientes (usado por el ranking de doctores).
 *
 * Por que existe: la version pro-rata (importe periodo × ratio
 * convertidos doctor/total) era una estimacion. R2b va a cruzar
 * contra contabilidad real desde semana 1 del piloto y cualquier
 * divergencia rompe confianza. Esta version suma los pagos reales
 * de los pacientes que el doctor convirtio.
 *
 * Sprint 14a — implementacion via filterByFormula directo sobre
 * Paciente_RecordId (texto plano rellenado por codigo). Sustituye al
 * workaround load-all+filter-JS del Sprint 13.1.1, que se introdujo
 * porque ARRAYJOIN({Paciente_Link}) devolvia el primary field
 * "PAT_NNN" en lugar de record IDs. Con Paciente_RecordId la formula
 * matchea limpio.
 *
 * Batching: filterByFormula tiene limite ~16k chars. Con
 * "{Paciente_RecordId}='recXXX'" (~40 chars por id) y wrapper OR(),
 * batches de 50 quedan muy lejos del limite. Cada batch se ejecuta en
 * paralelo (max 50 ids/batch × N batches concurrentes).
 *
 * Pendiente: suma Pacientes.Pendiente filtrada por pacienteIds
 * (no necesita rango de fecha — es saldo actual del paciente,
 * mantenido como cache por crearPago()).
 */
const BATCH_SIZE_PACIENTES = 50;

export async function getFacturadoPorPacientes(args: {
  pacienteIds: string[];
  desde: Date;
  hasta: Date;
}): Promise<{ total: number; pendiente: number; pagosCount: number }> {
  if (args.pacienteIds.length === 0) {
    return { total: 0, pendiente: 0, pagosCount: 0 };
  }
  const desdeISO = args.desde.toISOString().slice(0, 10);
  const hastaISO = args.hasta.toISOString().slice(0, 10);
  const desdeShift = shiftDay(desdeISO, -1);
  const hastaShift = shiftDay(hastaISO, 1);

  let total = 0;
  let pagosCount = 0;

  const batches: string[][] = [];
  for (let i = 0; i < args.pacienteIds.length; i += BATCH_SIZE_PACIENTES) {
    batches.push(args.pacienteIds.slice(i, i + BATCH_SIZE_PACIENTES));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const orPart = batch
        .map((id) => `{Paciente_RecordId}='${id}'`)
        .join(",");
      const formula = `AND(
        IS_AFTER({Fecha_Pago}, '${desdeShift}'),
        IS_BEFORE({Fecha_Pago}, '${hastaShift}'),
        OR(${orPart})
      )`.replace(/\s+/g, " ");
      try {
        const recs = await fetchAll(
          base(TABLES.pagosPaciente as any).select({
            filterByFormula: formula,
            fields: ["Importe"],
          }),
        );
        for (const r of recs) {
          total += Number((r.fields as any)?.["Importe"] ?? 0) || 0;
          pagosCount++;
        }
      } catch (err) {
        console.error(
          "[pagos] getFacturadoPorPacientes batch:",
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  // Pendiente: cache desde Pacientes.Pendiente (mantenido por crearPago).
  const pendiente = await getPendienteSum(args.pacienteIds);

  return { total, pendiente, pagosCount };
}

async function getPendienteSum(pacIds: string[]): Promise<number> {
  // FASE 1 migración: query + batching viven en el repo del dominio Pacientes.
  return sumPendientePorIds(pacIds);
}

// ─── Escritura ─────────────────────────────────────────────────────────

/**
 * Sprint 14a Bloque 6 — recalcula y reescribe Pacientes.Pagado +
 * Pacientes.Pendiente sumando todos los pagos del paciente. Si falla
 * deja entrada en Inconsistencias_Pagos para reconciliacion posterior.
 *
 * Estrategia: en lugar de aplicar deltas relativos (que se desalinean
 * en edits/eliminaciones), recalculamos el total absoluto desde la
 * tabla Pagos_Paciente. Mas robusto y trivial de razonar.
 */
async function syncPacienteCache(
  pacienteId: string,
  pagoIdContext: string | null,
): Promise<void> {
  try {
    // Sumar todos los pagos del paciente directamente.
    const pagos = await getPagosByPaciente(pacienteId);
    const totalPagado = pagos.reduce((s, p) => s + (p.importe || 0), 0);
    // FASE 1 migración: recalculo Pagado/Pendiente en el repo del dominio.
    await syncFinancieroPaciente(pacienteId, totalPagado);
  } catch (err) {
    console.error(
      "[pagos] sync Pacientes cache:",
      err instanceof Error ? err.message : err,
    );
    // Log a Inconsistencias_Pagos para reconciliacion via
    // /api/admin/reconciliar-pagos.
    try {
      await base(TABLES.inconsistenciasPagos as any).create([
        {
          fields: {
            Resumen: `Cache desync · paciente ${pacienteId}${pagoIdContext ? ` · pago ${pagoIdContext}` : ""}`,
            Pago_RecordId: pagoIdContext ?? "",
            Paciente_RecordId: pacienteId,
            Error: err instanceof Error ? err.message : String(err),
            Timestamp: new Date().toISOString(),
            Resuelto: false,
          },
        },
      ]);
    } catch (logErr) {
      // Si ni el log funciona, solo console.error.
      console.error(
        "[pagos] log inconsistencia tambien fallo:",
        logErr instanceof Error ? logErr.message : logErr,
      );
    }
  }
}

/**
 * Sprint 14a Bloque 6 — auditoria de operaciones CRUD en Acciones_Pago.
 * Fire-and-forget: si falla el log no abortamos la operacion principal,
 * solo console.error.
 */
async function logAccionPago(args: {
  pagoId: string;
  pacienteId: string;
  tipo: "Crear" | "Editar" | "Eliminar" | "Reembolsar";
  importeAntes?: number | null;
  importeDespues?: number | null;
  usuarioId?: string | null;
  notaCambio?: string;
}): Promise<void> {
  try {
    const fields: Record<string, unknown> = {
      Resumen: `${args.tipo} · ${args.pagoId.slice(0, 6)} · paciente ${args.pacienteId.slice(0, 6)}`,
      Pago_Link: [args.pagoId],
      Tipo: args.tipo,
      Fecha: new Date().toISOString(),
    };
    if (args.importeAntes != null) fields["Importe_Antes"] = args.importeAntes;
    if (args.importeDespues != null) fields["Importe_Despues"] = args.importeDespues;
    if (args.usuarioId) fields["Usuario"] = [args.usuarioId];
    if (args.notaCambio) fields["Nota_Cambio"] = args.notaCambio;
    await base(TABLES.accionesPago as any).create([{ fields } as any]);
  } catch (err) {
    console.error(
      "[pagos] log Acciones_Pago:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Crea un Pago en Pagos_Paciente y sincroniza Pacientes.Pagado (cache)
 * recalculando desde Pagos_Paciente. Audita en Acciones_Pago.
 */
export async function crearPago(args: {
  pacienteId: string;
  importe: number;
  fechaPago?: string; // ISO YYYY-MM-DD; default = hoy
  metodo?: MetodoPago;
  tipo?: TipoPago;
  nota?: string;
  /** Sprint 14a — id de Usuario que registra el pago (auditoria real). */
  usuarioCreadorId?: string;
}): Promise<Pago> {
  const fechaPago = args.fechaPago ?? new Date().toISOString().slice(0, 10);
  const metodo = args.metodo ?? "Otro";
  const tipo = args.tipo ?? "Liquidacion";
  const resumen = `${metodo} · ${fechaPago} · ${args.importe.toFixed(2)}€`;

  const created = (
    await base(TABLES.pagosPaciente as any).create(
      [
        {
          fields: {
            Resumen: resumen,
            Paciente_Link: [args.pacienteId],
            Paciente_RecordId: args.pacienteId,
            Fecha_Pago: fechaPago,
            Importe: args.importe,
            Metodo: metodo,
            Tipo: tipo,
            ...(args.nota ? { Nota: args.nota } : {}),
            ...(args.usuarioCreadorId
              ? { Usuario_Creador: [args.usuarioCreadorId] }
              : {}),
          },
        },
      ],
      // typecast: Airtable extiende los enums Tipo/Metodo si llega un
      // valor nuevo (necesario para Primer_Pago_Plan tras el re-scope).
      { typecast: true } as any,
    )
  )[0]!;

  await syncPacienteCache(args.pacienteId, created.id);
  await logAccionPago({
    pagoId: created.id,
    pacienteId: args.pacienteId,
    tipo: "Crear",
    importeAntes: null,
    importeDespues: args.importe,
    usuarioId: args.usuarioCreadorId,
    notaCambio: `Pago ${tipo} · ${metodo} · ${fechaPago}`,
  });

  return toPago(created);
}

/**
 * Sprint 14a Bloque 6 — actualiza un pago existente. Recalcula cache
 * desde Pagos_Paciente. Audita el cambio con importe antes/despues.
 */
export async function actualizarPago(
  pagoId: string,
  patch: Partial<{
    importe: number;
    fechaPago: string;
    metodo: MetodoPago;
    tipo: TipoPago;
    nota: string | null;
  }>,
  context: { usuarioId?: string | null } = {},
): Promise<Pago> {
  const before = await base(TABLES.pagosPaciente as any).find(pagoId);
  const beforeFields = before.fields as any;
  const importeAntes = Number(beforeFields["Importe"] ?? 0) || 0;
  const pacIds = (beforeFields["Paciente_Link"] ?? []) as string[];
  const pacienteId =
    String(beforeFields["Paciente_RecordId"] ?? "") || pacIds[0] || "";

  const fields: Record<string, unknown> = {};
  if (patch.importe !== undefined) fields["Importe"] = patch.importe;
  if (patch.fechaPago !== undefined) fields["Fecha_Pago"] = patch.fechaPago;
  if (patch.metodo !== undefined) fields["Metodo"] = patch.metodo;
  if (patch.tipo !== undefined) fields["Tipo"] = patch.tipo;
  if (patch.nota !== undefined) fields["Nota"] = patch.nota ?? "";
  // Refrescar Resumen si cambia algo visible.
  if (
    patch.importe !== undefined ||
    patch.fechaPago !== undefined ||
    patch.metodo !== undefined
  ) {
    const fechaPago = patch.fechaPago ?? String(beforeFields["Fecha_Pago"] ?? "").slice(0, 10);
    const metodo = patch.metodo ?? String(beforeFields["Metodo"] ?? "Otro");
    const importe = patch.importe ?? importeAntes;
    fields["Resumen"] = `${metodo} · ${fechaPago} · ${importe.toFixed(2)}€`;
  }

  const updated = (
    await (base(TABLES.pagosPaciente as any) as any).update(
      [{ id: pagoId, fields }],
      { typecast: true },
    )
  )[0]!;

  if (pacienteId) {
    await syncPacienteCache(pacienteId, pagoId);
  }
  const importeDespues = Number(((updated.fields as any) ?? {})["Importe"] ?? 0) || 0;
  await logAccionPago({
    pagoId,
    pacienteId,
    tipo: "Editar",
    importeAntes,
    importeDespues,
    usuarioId: context.usuarioId ?? null,
    notaCambio: Object.keys(patch).join(", "),
  });

  return toPago(updated);
}

/**
 * Sprint 14a Bloque 6 — elimina un pago. Recalcula cache. Audita.
 */
export async function eliminarPago(
  pagoId: string,
  context: { usuarioId?: string | null } = {},
): Promise<void> {
  const before = await base(TABLES.pagosPaciente as any).find(pagoId);
  const beforeFields = before.fields as any;
  const importeAntes = Number(beforeFields["Importe"] ?? 0) || 0;
  const pacIds = (beforeFields["Paciente_Link"] ?? []) as string[];
  const pacienteId =
    String(beforeFields["Paciente_RecordId"] ?? "") || pacIds[0] || "";

  await logAccionPago({
    pagoId,
    pacienteId,
    tipo: "Eliminar",
    importeAntes,
    importeDespues: null,
    usuarioId: context.usuarioId ?? null,
    notaCambio: `Pago ${beforeFields["Tipo"] ?? ""} de ${importeAntes}€ eliminado`,
  });
  await base(TABLES.pagosPaciente as any).destroy([pagoId]);
  if (pacienteId) {
    await syncPacienteCache(pacienteId, pagoId);
  }
}

/**
 * Sprint 14a Bloque 6 — recompute Pacientes.Pagado/Pendiente para una
 * lista de pacienteIds (o todos los listados en Inconsistencias_Pagos
 * sin resolver, si no se pasan). Endpoint admin lo invoca.
 */
export async function reconciliarPagosCache(args: {
  pacienteIds?: string[];
}): Promise<{ procesados: number; ok: number; errores: number }> {
  let pacienteIds = args.pacienteIds;
  let inconsistenciaIds: string[] = [];
  if (!pacienteIds) {
    // Cargar todos los pacientes con Inconsistencias.Resuelto=false.
    const recs = await fetchAll(
      base(TABLES.inconsistenciasPagos as any).select({
        filterByFormula: `NOT({Resuelto})`,
        fields: ["Paciente_RecordId"],
      }),
    );
    inconsistenciaIds = recs.map((r) => r.id);
    pacienteIds = Array.from(
      new Set(
        recs
          .map((r) => String(((r.fields as any) ?? {})["Paciente_RecordId"] ?? ""))
          .filter(Boolean),
      ),
    );
  }
  let ok = 0;
  let errores = 0;
  for (const pid of pacienteIds) {
    try {
      const pagos = await getPagosByPaciente(pid);
      const totalPagado = pagos.reduce((s, p) => s + (p.importe || 0), 0);
      // FASE 1 migración: mismo recalculo via repo del dominio Pacientes.
      await syncFinancieroPaciente(pid, totalPagado);
      ok++;
    } catch (err) {
      console.error(
        `[reconciliar] paciente ${pid}:`,
        err instanceof Error ? err.message : err,
      );
      errores++;
    }
  }
  // Marcar inconsistencias como resueltas (solo si no se pasaron pacIds
  // a mano — en ese caso es reconciliacion manual, no la batch del log).
  if (!args.pacienteIds && inconsistenciaIds.length > 0) {
    for (let i = 0; i < inconsistenciaIds.length; i += 10) {
      const slice = inconsistenciaIds.slice(i, i + 10);
      try {
        await base(TABLES.inconsistenciasPagos as any).update(
          slice.map((id) => ({ id, fields: { Resuelto: true } })),
        );
      } catch { /* noop */ }
    }
  }
  return { procesados: pacienteIds.length, ok, errores };
}

// ─── Util fechas ─────────────────────────────────────────────────────

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — lectura consolidada de Pagos_Paciente para los
// consumidores externos (cola-cobros, kpis/cobros, copilot, alertas).
// Un método con periodo opcional sustituye 5 queries casi idénticas.
// ─────────────────────────────────────────────────────────────────────

export type PagoResumen = {
  pacienteRecordId: string;
  importe: number;
  metodo: string;
  tipo: string;
  /** ISO completo tal cual está en Airtable; el caller recorta si quiere. */
  fechaPago: string;
};

/**
 * Pagos con campos de resumen. Sin opts = all-time. Con bounds (ya
 * desplazados ±1 día por el caller, IS_AFTER/IS_BEFORE son exclusivos)
 * filtra por Fecha_Pago; un solo bound también vale (copilot).
 */
export async function listPagosResumen(opts: {
  desdeExclusivoIso?: string;
  hastaExclusivoIso?: string;
} = {}): Promise<PagoResumen[]> {
  const partes: string[] = [];
  if (opts.desdeExclusivoIso) partes.push(`IS_AFTER({Fecha_Pago}, '${opts.desdeExclusivoIso}')`);
  if (opts.hastaExclusivoIso) partes.push(`IS_BEFORE({Fecha_Pago}, '${opts.hastaExclusivoIso}')`);
  const filterByFormula =
    partes.length > 1 ? `AND(${partes.join(",")})` : partes.length === 1 ? partes[0] : undefined;
  const recs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      ...(filterByFormula ? { filterByFormula } : {}),
      fields: ["Paciente_RecordId", "Importe", "Metodo", "Tipo", "Fecha_Pago"],
    }),
  );
  return recs.map((r) => {
    const f = r.fields as any;
    return {
      pacienteRecordId: String(f["Paciente_RecordId"] ?? ""),
      importe: Number(f["Importe"] ?? 0) || 0,
      metodo: String(f["Metodo"] ?? ""),
      tipo: String(f["Tipo"] ?? ""),
      fechaPago: String(f["Fecha_Pago"] ?? ""),
    };
  });
}
