// app/lib/presupuestos/pg.ts — FASE 2: dominio Presupuestos sobre Postgres.
//
// selectPresupuestosRaw es passthrough de FÓRMULAS Airtable compuestas por
// los callers (FASE 1). Aquí se resuelven con un EVALUADOR del subconjunto
// usado (AND/OR/NOT, comparaciones, BLANK, IS_AFTER/IS_BEFORE, DATEADD(TODAY),
// FIND/LOWER/ARRAYJOIN, RECORD_ID) evaluado en JS sobre los shims — mismo
// resultado que Airtable, sin traducir SQL. Volumen acotado (maxRecords 2000).

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[presupuestos-pg] sin cliente (fail-closed)");
  return c;
}
const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const d10 = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

type Shim = { id: string; fields: Record<string, unknown>; get: (k: string) => unknown; _rawJson: { createdTime: string } };

const PRES_SELECT = `
  select pr.*, pa.nombre as _pac_nombre, pa.telefono as _pac_tel, cl.nombre as _cli_nombre
  from presupuestos pr
  left join pacientes pa on pa.cliente = pr.cliente and pa.id = pr.paciente_id
  left join clinicas cl on cl.cliente = pr.cliente and cl.id = pr.clinica_id`;

function presShim(r: any): Shim {
  const f: Record<string, unknown> = {
    "Presupuesto ID": r.presupuesto_id_negocio, "Tratamiento_nombre": r.tratamiento_nombre,
    "Estado": r.estado, "Fecha": d10(r.fecha) || undefined, "FechaAlta": d10(r.fecha_alta) || undefined,
    "Fecha_Aceptado": d10(r.fecha_aceptado) || undefined, "Importe": r.importe != null ? Number(r.importe) : undefined,
    "Notas": r.notas, "Doctor": r.doctor, "Doctor_Especialidad": r.doctor_especialidad,
    "TipoPaciente": r.tipo_paciente, "TipoVisita": r.tipo_visita,
    "Clinica": r._cli_nombre, "ContactCount": r.contact_count != null ? Number(r.contact_count) : undefined,
    "CreadoPor": r.creado_por, "NumHistoria": r.num_historia, "OrigenLead": r.origen_lead,
    "MotivoPerdida": r.motivo_perdida, "Motivo_perdida": r.motivo_perdida,
    "MotivoPerdidaTexto": r.motivo_perdida_texto, "MotivoDuda": r.motivo_duda,
    "Reactivacion": r.reactivacion || undefined, "PortalEnviado": r.portal_enviado || undefined,
    "OfertaActiva": r.oferta_activa || undefined,
    "UltimoContacto": d10(r.ultimo_contacto) || undefined, "Paciente_Telefono": r.paciente_telefono,
    "Ultima_respuesta_paciente": r.ultima_respuesta_paciente,
    "Fecha_ultima_respuesta": r.fecha_ultima_respuesta ? iso(r.fecha_ultima_respuesta) : undefined,
    "Intencion_detectada": r.intencion_detectada, "Urgencia_intervencion": r.urgencia_intervencion,
    "Accion_sugerida": r.accion_sugerida, "Mensaje_sugerido": r.mensaje_sugerido,
    "Fase_seguimiento": r.fase_seguimiento,
    "Ultima_accion_registrada": r.ultima_accion_registrada ? iso(r.ultima_accion_registrada) : undefined,
    "Tipo_ultima_accion": r.tipo_ultima_accion,
    "Paciente": r.paciente_id ? [r.paciente_id] : undefined,
    "Paciente_Link": r.paciente_id ? [r.paciente_id] : undefined,
    "Paciente_nombre": r._pac_nombre ? [r._pac_nombre] : undefined,
    "Teléfono": r._pac_tel ? [r._pac_tel] : undefined,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined || f[k] === null || f[k] === "") delete f[k];
  return { id: r.id, fields: f, get: (k) => f[k], _rawJson: { createdTime: iso(r.created_at) } };
}

// ─── Evaluador de fórmulas (subconjunto usado por los callers) ────────
type Ctx = { rec: Shim };
function evalFormula(src: string, ctx: Ctx): boolean {
  let i = 0;
  const s = src;
  const ws = () => { while (i < s.length && /\s/.test(s[i]!)) i++; };
  const lit = (t: string) => { ws(); if (s.slice(i, i + t.length).toUpperCase() === t) { i += t.length; return true; } return false; };
  function valor(): unknown {
    ws();
    if (lit("AND(")) { const xs = args(); return xs.every(Boolean); }
    if (lit("OR(")) { const xs = args(); return xs.some(Boolean); }
    if (lit("NOT(")) { const xs = args(); return !xs[0]; }
    if (lit("BLANK()")) return "";
    if (lit("TRUE()")) return true;
    if (lit("FALSE()")) return false;
    if (lit("TODAY()")) return new Date().toISOString().slice(0, 10);
    if (lit("RECORD_ID()")) return ctx.rec.id;
    if (lit("LOWER(")) { const xs = args(); return String(xs[0] ?? "").toLowerCase(); }
    if (lit("ARRAYJOIN(")) { const xs = args(); const v = xs[0]; const sep = xs.length > 1 ? String(xs[1]) : ","; return Array.isArray(v) ? v.join(sep) : String(v ?? ""); }
    if (lit("SUBSTITUTE(")) { const xs = args(); return String(xs[0] ?? "").split(String(xs[1] ?? "")).join(String(xs[2] ?? "")); }
    if (lit("FIND(")) { const xs = args(); const p = String(xs[1] ?? "").indexOf(String(xs[0] ?? "")); return p + 1; }
    if (lit("IS_AFTER(")) { const xs = args(); return new Date(String(xs[0])).getTime() > new Date(String(xs[1])).getTime(); }
    if (lit("IS_BEFORE(")) { const xs = args(); return new Date(String(xs[0])).getTime() < new Date(String(xs[1])).getTime(); }
    if (lit("IS_SAME(")) { const xs = args(); const a = d10(xs[0]), b = d10(xs[1]); return a === b; }
    if (lit("DATEADD(")) {
      const xs = args(); const base = new Date(String(xs[0]) + (String(xs[0]).length === 10 ? "T00:00:00Z" : ""));
      const n = Number(xs[1]); const unit = String(xs[2] ?? "days").toLowerCase();
      if (unit.startsWith("month")) base.setUTCMonth(base.getUTCMonth() + n);
      else base.setUTCDate(base.getUTCDate() + n);
      return base.toISOString().slice(0, 10);
    }
    if (s[i] === "{") { const j = s.indexOf("}", i); const campo = s.slice(i + 1, j); i = j + 1; const v = ctx.rec.fields[campo]; return concatTail(v ?? ""); }
    if (s[i] === "'" || s[i] === '"') { const q = s[i]!; let j = i + 1, out = ""; while (j < s.length && s[j] !== q) { out += s[j]; j++; } i = j + 1; return concatTail(out); }
    const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    throw new Error(`formula no soportada @${i}: ${s.slice(i, i + 30)}`);
  }
  function concatTail(v: unknown): unknown { ws(); if (s[i] === "&") { i++; const rhs = valor(); return String(Array.isArray(v) ? v.join(",") : v ?? "") + String(rhs ?? ""); } return v; }
  function comparar(): unknown {
    let left = valor(); ws();
    const ops = ["!=", ">=", "<=", "=", ">", "<"];
    for (const op of ops) {
      if (s.slice(i, i + op.length) === op) {
        i += op.length; const right = valor();
        const l = Array.isArray(left) ? left.join(",") : left; const r = Array.isArray(right) ? right.join(",") : right;
        const ln = typeof l === "number" || typeof r === "number";
        const [a, b] = ln ? [Number(l ?? 0), Number(r ?? 0)] : [String(l ?? ""), String(r ?? "")];
        switch (op) { case "=": return a === b || (l === true && r === 1) || String(l) === String(r);
          case "!=": return String(l ?? "") !== String(r ?? ""); case ">": return a > b; case "<": return a < b; case ">=": return a >= b; case "<=": return a <= b; }
      }
    }
    return left;
  }
  function args(): unknown[] {
    const out: unknown[] = [];
    while (true) { out.push(comparar()); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === ")") { i++; break; } if (i >= s.length) break; throw new Error(`args @${i}: ${s.slice(i, i + 20)}`); }
    return out;
  }
  const r = comparar();
  return Boolean(r);
}

async function todosShims(): Promise<Shim[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql.raw(`${PRES_SELECT} order by pr.created_at asc, pr.id asc`).execute(trx);
    return (r.rows as any[]).map(presShim);
  });
}

const CAMPO_SORT: Record<string, (s: Shim) => string> = {
  "Fecha": (x) => String(x.fields["Fecha"] ?? ""),
  "Fecha_ultima_respuesta": (x) => String(x.fields["Fecha_ultima_respuesta"] ?? ""),
};

export async function selectPresupuestosRawPg(opts: {
  fields?: string[]; filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>; maxRecords?: number; pageSize?: number;
} = {}): Promise<any[]> {
  let recs = await todosShims();
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.sort?.length) {
    const { field, direction } = opts.sort[0]!;
    const key = CAMPO_SORT[field] ?? ((x: Shim) => String(x.fields[field] ?? ""));
    recs.sort((a, b) => (direction === "desc" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
  }
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}

export async function getPresupuestoPorIdRawPg(id: string, _fields?: string[]): Promise<any | null> {
  const recs = await selectPresupuestosRawPg({ filterByFormula: `RECORD_ID()='${id}'`, maxRecords: 1 });
  return recs[0] ?? null;
}
export async function findPresupuestoRawPg(id: string): Promise<any> {
  const r = await getPresupuestoPorIdRawPg(id);
  if (!r) throw new Error(`presupuesto no encontrado: ${id}`);
  return r;
}

const W: Record<string, string> = {
  "Tratamiento_nombre": "tratamiento_nombre", "Estado": "estado", "Fecha": "fecha", "FechaAlta": "fecha_alta",
  "Fecha_Aceptado": "fecha_aceptado", "Importe": "importe", "Notas": "notas", "Doctor": "doctor",
  "Doctor_Especialidad": "doctor_especialidad", "TipoPaciente": "tipo_paciente", "TipoVisita": "tipo_visita",
  "ContactCount": "contact_count", "CreadoPor": "creado_por", "OrigenLead": "origen_lead",
  "MotivoPerdida": "motivo_perdida", "MotivoPerdidaTexto": "motivo_perdida_texto", "MotivoDuda": "motivo_duda",
  "Reactivacion": "reactivacion", "PortalEnviado": "portal_enviado", "OfertaActiva": "oferta_activa",
  "UltimoContacto": "ultimo_contacto", "Paciente_Telefono": "paciente_telefono",
  "Ultima_respuesta_paciente": "ultima_respuesta_paciente", "Fecha_ultima_respuesta": "fecha_ultima_respuesta",
  "Intencion_detectada": "intencion_detectada", "Urgencia_intervencion": "urgencia_intervencion",
  "Accion_sugerida": "accion_sugerida", "Mensaje_sugerido": "mensaje_sugerido",
  "Fase_seguimiento": "fase_seguimiento", "Ultima_accion_registrada": "ultima_accion_registrada",
  "Tipo_ultima_accion": "tipo_ultima_accion",
};
const TS_COLS = new Set(["fecha_ultima_respuesta", "ultima_accion_registrada"]);

function fieldsToSet(fields: Record<string, unknown>): { set: Record<string, unknown>; pacienteId?: string; clinicaNombre?: string } {
  const set: Record<string, unknown> = {};
  let pacienteId: string | undefined; let clinicaNombre: string | undefined;
  for (const [k, v] of Object.entries(fields)) {
    if (k === "Paciente" || k === "Paciente_Link") { pacienteId = Array.isArray(v) ? String(v[0]) : String(v); continue; }
    if (k === "Clinica") { clinicaNombre = v == null ? undefined : String(v); continue; }
    const col = W[k];
    if (!col) continue;
    set[col] = TS_COLS.has(col) && v ? new Date(String(v)) : (v === "" ? null : v);
  }
  return { set, pacienteId, clinicaNombre };
}

export async function updatePresupuestoRawPg(id: string, fields: Record<string, unknown>, _opts: { typecast?: boolean } = {}): Promise<void> {
  const { set, pacienteId, clinicaNombre } = fieldsToSet(fields);
  await runWithClienteDb(cli(), async (trx) => {
    if (pacienteId !== undefined) (set as any).paciente_id = pacienteId;
    if (clinicaNombre !== undefined) {
      const c2 = await trx.selectFrom("clinicas").select("id").where("nombre", "=", clinicaNombre).executeTakeFirst();
      (set as any).clinica_id = c2?.id ?? null;
    }
    await trx.updateTable("presupuestos").set(set as any).where("id", "=", id).execute();
  });
}
export async function createPresupuestoRawPg(fields: Record<string, unknown>): Promise<any> {
  const { set, pacienteId, clinicaNombre } = fieldsToSet(fields);
  const row = await runWithClienteDb(cli(), async (trx) => {
    let clinicaId: string | null = null;
    if (clinicaNombre) {
      const c2 = await trx.selectFrom("clinicas").select("id").where("nombre", "=", clinicaNombre).executeTakeFirst();
      clinicaId = c2?.id ?? null;
    }
    return trx.insertInto("presupuestos").values({ cliente: cli(), ...set, paciente_id: pacienteId ?? null, clinica_id: clinicaId } as any)
      .returningAll().executeTakeFirstOrThrow();
  });
  return (await getPresupuestoPorIdRawPg(row.id))!;
}
export async function createPresupuestosBatchRawPg(batch: Array<{ fields: Record<string, unknown> }>): Promise<any[]> {
  const out: any[] = [];
  for (const b of batch) out.push(await createPresupuestoRawPg(b.fields));
  return out;
}
export async function sampleUsuariosPresupuestosFieldsDevPg(_n: number): Promise<any[]> { return []; }

// ─── Contactos ────────────────────────────────────────────────────────
function contShim(r: any): Shim {
  const f: Record<string, unknown> = {
    "PresupuestoId": r.presupuesto_id, "TipoContacto": r.tipo_contacto, "Resultado": r.resultado,
    "FechaHora": r.fecha_hora ? iso(r.fecha_hora) : undefined, "Nota": r.nota, "RegistradoPor": r.registrado_por,
    "MensajeIAUsado": r.mensaje_ia_usado || undefined, "TonoUsado": r.tono_usado, "Oferta": r.oferta || undefined,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined || f[k] === null || f[k] === "") delete f[k];
  return { id: r.id, fields: f, get: (k) => f[k], _rawJson: { createdTime: iso(r.created_at) } };
}
export async function listContactosDePresupuestoRawPg(presupuestoId: string): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("contactos_presupuesto").selectAll()
      .where("presupuesto_id", "=", presupuestoId).orderBy("fecha_hora", "desc").limit(100).execute();
    return rows.map(contShim);
  });
}
export async function listContactosConTonoRawPg(): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const rows = await trx.selectFrom("contactos_presupuesto").selectAll()
      .where("mensaje_ia_usado", "=", true).where("tono_usado", "is not", null).limit(2000).execute();
    return rows.filter((r: any) => r.tono_usado !== "").map(contShim);
  });
}
async function insertContacto(fields: Record<string, unknown>): Promise<any> {
  const row = await runWithClienteDb(cli(), (trx) =>
    trx.insertInto("contactos_presupuesto").values({
      cliente: cli(), presupuesto_id: String(fields["PresupuestoId"] ?? ""),
      tipo_contacto: fields["TipoContacto"] ?? null, resultado: fields["Resultado"] ?? null,
      fecha_hora: fields["FechaHora"] ? new Date(String(fields["FechaHora"])) : null,
      nota: fields["Nota"] ?? null, registrado_por: fields["RegistradoPor"] ?? null,
      mensaje_ia_usado: Boolean(fields["MensajeIAUsado"] ?? false), tono_usado: fields["TonoUsado"] ?? null,
      oferta: Boolean(fields["Oferta"] ?? false),
    } as any).returningAll().executeTakeFirstOrThrow());
  return contShim(row);
}
export async function createContactoRawPg(fields: Record<string, unknown>): Promise<void> { await insertContacto(fields); }
export async function createContactoConRecordRawPg(fields: Record<string, unknown>): Promise<any> { return insertContacto(fields); }

// ─── Objetivos ────────────────────────────────────────────────────────
const OBJ_SELECT = `select o.*, cl.nombre as _cli_nombre from objetivos_mensuales o
  left join clinicas cl on cl.cliente = o.cliente and cl.id = o.clinica_id`;
function objShim(r: any): Shim {
  const f: Record<string, unknown> = { clinica: r._cli_nombre ?? undefined, mes: r.mes, objetivo_aceptados: r.objetivo_aceptados != null ? Number(r.objetivo_aceptados) : undefined };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return { id: r.id, fields: f, get: (k) => f[k], _rawJson: { createdTime: iso(r.created_at) } };
}
export async function listObjetivosRawPg(filterByFormula: string): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql.raw(`${OBJ_SELECT} order by o.created_at asc`).execute(trx);
    const shims = (r.rows as any[]).map(objShim);
    return shims.filter((rec) => evalFormula(filterByFormula, { rec }));
  });
}
export async function findObjetivoRawPg(clinica: string, mes: string): Promise<any | null> {
  const recs = await listObjetivosRawPg(`AND({clinica}="${clinica}",{mes}="${mes}")`);
  return recs[0] ?? null;
}
export async function updateObjetivoRawPg(id: string, fields: Record<string, unknown>): Promise<void> {
  const set: Record<string, unknown> = {};
  if (fields["objetivo_aceptados"] !== undefined) set.objetivo_aceptados = fields["objetivo_aceptados"];
  if (fields["actualizado_en"] !== undefined) set.actualizado_en = new Date(String(fields["actualizado_en"]));
  await runWithClienteDb(cli(), (trx) => trx.updateTable("objetivos_mensuales").set(set as any).where("id", "=", id).execute());
}
export async function createObjetivoRawPg(fields: Record<string, unknown>): Promise<void> {
  await runWithClienteDb(cli(), async (trx) => {
    const cl2 = fields["clinica"] ? await trx.selectFrom("clinicas").select("id").where("nombre", "=", String(fields["clinica"])).executeTakeFirst() : null;
    await trx.insertInto("objetivos_mensuales").values({
      cliente: cli(), clinica_id: cl2?.id ?? null, mes: String(fields["mes"] ?? "0000-00"),
      objetivo_aceptados: fields["objetivo_aceptados"] ?? null, creado_por: fields["creado_por"] ?? null,
      actualizado_en: fields["actualizado_en"] ? new Date(String(fields["actualizado_en"])) : new Date(),
    } as any).execute();
  });
}

// ─── Doctores ─────────────────────────────────────────────────────────
export async function listDoctoresPresupuestosRawPg(filterByFormula: string): Promise<any[]> {
  return runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql.raw(`select d.*, cl.nombre as _cli_nombre from doctores_presupuestos d
      left join clinicas cl on cl.cliente = d.cliente and cl.id = d.clinica_id order by d.nombre asc`).execute(trx);
    const shims = (r.rows as any[]).map((row: any) => {
      const f: Record<string, unknown> = { "Nombre": row.nombre, "Especialidad": row.especialidad, "Clinica": row._cli_nombre, "Activo": row.activo || undefined };
      for (const k of Object.keys(f)) if (f[k] == null) delete f[k];
      return { id: row.id, fields: f, get: (k: string) => f[k], _rawJson: { createdTime: iso(row.created_at) } };
    });
    // Paridad: en Airtable-DEMO esta tabla no existe y el read LANZA (la ruta
    // deriva doctores de Presupuestos en el catch). Tabla vacía ≡ no disponible.
    if (shims.length === 0) throw new Error("doctores_presupuestos vacía (fallback a derivar)");
    return shims.filter((rec) => evalFormula(filterByFormula, { rec })).slice(0, 100);
  });
}
