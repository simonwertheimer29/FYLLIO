// app/lib/presupuestos/clinica-scope.ts
//
// Sprint B Fase 4 — aislamiento por clínica DENTRO de la base de un cliente.
//
// La autorización se decide por IDs de clínica (`clinicasAccesibles`, de la base
// de Identidad), NO por el antiguo `session.clinica` (nombre): ese campo hoy es
// siempre `null` y por eso el filtro por clínica estaba muerto (una coordinadora
// veía los presupuestos de todas las clínicas de su cliente).
//
// Los datos de negocio de Presupuestos guardan la clínica por NOMBRE, así que
// resolvemos ID -> nombre aquí, en la frontera. La decisión de acceso sigue
// siendo por ID; el nombre es solo la clave de unión con los datos legacy.
//
// El aislamiento ENTRE clientes (RB vs INDEP) ya está garantizado por bases
// físicas separadas (runWithCliente). Esto añade el aislamiento por clínica
// dentro del mismo cliente.
//
// SOLO servidor (importa listClinicas -> airtable). No importar desde componentes
// cliente.

import { listClinicas } from "../auth/users";
import { base, TABLES } from "../airtable";
import type { UserSession } from "./types";

/**
 * Nombres de clínica que la sesión puede ver.
 *  - `null`  => sin restricción (admin/manager con `["*"]`): ve todo su cliente.
 *  - `Set`   => solo esas clínicas (coordinación).
 * Fail-closed: sin `clinicasAccesibles`, `Set` vacío (no ve nada).
 */
export async function nombresClinicasPermitidas(
  session: UserSession,
): Promise<Set<string> | null> {
  const acc = session.clinicasAccesibles;
  if (acc && acc.includes("*")) return null;
  if (!acc || acc.length === 0) return new Set<string>();
  const clinicas = await listClinicas({ cliente: session.cliente ?? undefined });
  const byId = new Map(clinicas.map((c) => [c.id, c.nombre]));
  const nombres = new Set<string>();
  for (const id of acc) {
    const n = byId.get(id);
    if (n) nombres.add(n);
  }
  return nombres;
}

/** ¿La sesión puede ver esta clínica (por nombre)? `null` permitidas = sí. */
export function permiteClinica(permitidas: Set<string> | null, nombre: string): boolean {
  return permitidas === null || permitidas.has(nombre);
}

/** Escapa una comilla simple para filterByFormula de Airtable. */
function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

/**
 * Fragmento `filterByFormula` que restringe `{field}` a las clínicas permitidas.
 *  - permitidas `null`  => `null` (sin restricción; el caller no añade filtro).
 *  - permitidas vacío   => `"FALSE()"` (no ve nada).
 *  - `todasBucket` (p.ej. "todas"/"Todas") incluye ese valor global compartido.
 * Campo de texto simple ({Clinica}='X'). Para campos link/multi ver
 * `formulaClinicaPermitidaArray`.
 */
export function formulaClinicaPermitida(
  permitidas: Set<string> | null,
  field: string,
  todasBucket?: string,
): string | null {
  if (permitidas === null) return null;
  const vals = [...permitidas];
  if (todasBucket) vals.push(todasBucket);
  if (vals.length === 0) return "FALSE()";
  const ors = vals.map((v) => `{${field}}='${esc(v)}'`);
  return ors.length === 1 ? ors[0]! : `OR(${ors.join(",")})`;
}

/**
 * Variante de `formulaClinicaPermitida` para campos link/multi de Airtable,
 * usando `FIND(nombre, ARRAYJOIN({field}))`.
 */
export function formulaClinicaPermitidaArray(
  permitidas: Set<string> | null,
  field: string,
): string | null {
  if (permitidas === null) return null;
  const vals = [...permitidas];
  if (vals.length === 0) return "FALSE()";
  const ors = vals.map((v) => `FIND('${esc(v)}', ARRAYJOIN({${field}}))`);
  return ors.length === 1 ? ors[0]! : `OR(${ors.join(",")})`;
}

/**
 * Sprint B Fase 4 (IDOR) — verifica que un presupuesto (por id) pertenezca a una
 * clínica que la sesión puede ver, ANTES de devolver o mutar datos asociados
 * (mensajes, historial, contactos…). Debe llamarse dentro de un handler que ya
 * corre en el contexto de cliente (runWithCliente), de modo que `base()` resuelve
 * la base del cliente; un id de OTRO cliente ni siquiera existe aquí (bases
 * físicas separadas) y devuelve "not_found".
 *
 * Devuelve:
 *  - "ok"        => permitido (o admin/manager sin restricción de clínica).
 *  - "not_found" => el presupuesto no existe en la base del cliente.
 *  - "forbidden" => existe pero es de otra clínica del mismo cliente.
 * El caller decide el status; se recomienda 404 en ambos casos negativos para no
 * revelar la existencia de presupuestos de otras clínicas.
 */
export async function verificarPresupuestoPermitido(
  session: UserSession,
  presupuestoId: string,
): Promise<"ok" | "not_found" | "forbidden"> {
  const permitidas = await nombresClinicasPermitidas(session);
  if (permitidas === null) return "ok";
  const rec = await base(TABLES.presupuestos as any)
    .find(presupuestoId)
    .catch(() => null);
  if (!rec) return "not_found";
  const raw = (rec.fields as Record<string, unknown>)["Clinica"];
  const clinica = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
  return permiteClinica(permitidas, clinica) ? "ok" : "forbidden";
}

/**
 * Sprint B Fase 4 — mapa `presupuestoId -> nombre de clínica`, resolviendo en
 * lotes (para colecciones que referencian el presupuesto por id pero NO guardan
 * la clínica, p.ej. la cola de envíos). Debe correr en el contexto de cliente.
 * Los ids inexistentes en la base del cliente simplemente no aparecen en el mapa.
 */
export async function mapaPresupuestoClinica(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  const CHUNK = 40;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const formula = `OR(${slice.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(TABLES.presupuestos as any)
      .select({ filterByFormula: formula, fields: ["Clinica"], maxRecords: slice.length })
      .all()
      .catch(() => [] as Array<{ id: string; fields: Record<string, unknown> }>);
    for (const r of recs) {
      const raw = (r.fields as Record<string, unknown>)["Clinica"];
      out.set(r.id, Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? ""));
    }
  }
  return out;
}
