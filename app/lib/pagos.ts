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

export type MetodoPago =
  | "Efectivo"
  | "Tarjeta"
  | "Transferencia"
  | "Bizum"
  | "Financiacion"
  | "Otro";
export type TipoPago = "Pago_Unico" | "Cuota" | "Senal" | "Liquidacion";

export type Pago = {
  id: string;
  pacienteId: string;
  fechaPago: string; // ISO date YYYY-MM-DD
  importe: number;
  metodo: MetodoPago;
  tipo: TipoPago;
  nota: string | null;
  createdAt: string; // ISO datetime
  /** Sprint 14a — id del Usuario Fyllio que registro el pago. null para
   *  pagos migrados (Sprint 13.1) o sesiones admin sin clinica
   *  asignable. La UI lo resuelve a nombre via map cliente, sin N+1. */
  usuarioCreadorId: string | null;
};

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
  const formulaPac = `OR(${pacIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  let pacRecs: any[] = [];
  try {
    pacRecs = await fetchAll(
      base(TABLES.patients as any).select({
        filterByFormula: formulaPac,
        fields: ["Clínica", "Lead_Origen", "Pendiente"],
      }),
    );
  } catch (err) {
    console.error("[pagos] crossing pacientes:", err instanceof Error ? err.message : err);
    return { total: 0, pendiente: 0, pagosCount: 0 };
  }
  const pacAllowed = new Set<string>();
  let pendienteSum = 0;
  for (const r of pacRecs) {
    const f = r.fields as any;
    const clinicas = (f["Clínica"] ?? []) as string[];
    const origenLead = f["Lead_Origen"];
    const ok =
      (!args.clinicaId || clinicas.includes(args.clinicaId)) &&
      (!args.soloOrigenLead || (origenLead != null && origenLead !== ""));
    if (ok) {
      pacAllowed.add(r.id);
      pendienteSum += Number(f["Pendiente"] ?? 0) || 0;
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
  if (pacIds.length === 0) return 0;
  // Sprint 13.1.1 — batching simetrico al de getFacturadoPorPacientes
  // para evitar fallos silenciosos cuando se pasan muchos IDs.
  if (pacIds.length > BATCH_SIZE_PACIENTES) {
    let total = 0;
    for (let i = 0; i < pacIds.length; i += BATCH_SIZE_PACIENTES) {
      total += await getPendienteSum(pacIds.slice(i, i + BATCH_SIZE_PACIENTES));
    }
    return total;
  }
  const formula = `OR(${pacIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  try {
    const recs = await fetchAll(
      base(TABLES.patients as any).select({
        filterByFormula: formula,
        fields: ["Pendiente"],
      }),
    );
    return recs.reduce(
      (s, r) => s + (Number((r.fields as any)?.["Pendiente"] ?? 0) || 0),
      0,
    );
  } catch {
    return 0;
  }
}

// ─── Escritura ─────────────────────────────────────────────────────────

/**
 * Crea un Pago en Pagos_Paciente y sincroniza Pacientes.Pagado (cache).
 * Si el campo Pendiente es positivo, le resta el importe del pago (sin
 * pasar de cero).
 */
export async function crearPago(args: {
  pacienteId: string;
  importe: number;
  fechaPago?: string; // ISO YYYY-MM-DD; default = hoy
  metodo?: MetodoPago;
  tipo?: TipoPago;
  nota?: string;
  /** Sprint 14a — id de Usuario que registra el pago (auditoria real).
   *  Si no se pasa, queda vacio y la UI muestra "Coordinacion" como
   *  fallback (caso admin sin clinica especifica o llamadas pre-S14). */
  usuarioCreadorId?: string;
}): Promise<Pago> {
  const fechaPago = args.fechaPago ?? new Date().toISOString().slice(0, 10);
  const metodo = args.metodo ?? "Otro";
  const tipo = args.tipo ?? "Pago_Unico";
  const resumen = `${metodo} · ${fechaPago} · ${args.importe.toFixed(2)}€`;

  const created = (await base(TABLES.pagosPaciente as any).create([
    {
      fields: {
        Resumen: resumen,
        Paciente_Link: [args.pacienteId],
        // Sprint 14a — texto plano para filterByFormula directo.
        Paciente_RecordId: args.pacienteId,
        Fecha_Pago: fechaPago,
        Importe: args.importe,
        Metodo: metodo,
        Tipo: tipo,
        ...(args.nota ? { Nota: args.nota } : {}),
        ...(args.usuarioCreadorId ? { Usuario_Creador: [args.usuarioCreadorId] } : {}),
      },
    },
  ]))[0]!;

  // Sincronizar cache en Pacientes.Pagado / Pendiente.
  try {
    const pacRec = await base(TABLES.patients as any).find(args.pacienteId);
    const f = pacRec.fields as any;
    const pagadoActual = Number(f["Pagado"] ?? 0) || 0;
    const pendienteActual = Number(f["Pendiente"] ?? 0) || 0;
    const nuevoPagado = pagadoActual + args.importe;
    const nuevoPendiente = Math.max(0, pendienteActual - args.importe);
    await base(TABLES.patients as any).update(args.pacienteId, {
      Pagado: nuevoPagado,
      Pendiente: nuevoPendiente,
    } as any);
  } catch (err) {
    console.error("[pagos] sync Pacientes cache:", err instanceof Error ? err.message : err);
    // No re-lanzamos: el pago quedo registrado, la cache se puede
    // recomputar mas adelante.
  }

  return toPago(created);
}

// ─── Util fechas ─────────────────────────────────────────────────────

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
