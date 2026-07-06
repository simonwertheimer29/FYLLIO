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
