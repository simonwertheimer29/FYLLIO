// app/lib/clinicas-negocio.ts
//
// Sprint B — puente entre los IDs de clínica de la base CENTRAL (identidad/auth)
// y los de la base de NEGOCIO del cliente. Son bases físicas distintas, así que
// una misma clínica tiene record IDs DIFERENTES en cada una; el único puente
// estable es el NOMBRE.
//
// Lo usan las vistas que filtran datos de negocio por ID de clínica (Pacientes,
// Leads, Actuar-hoy, Copiloto): el usuario llega con sus clínicas accesibles en
// IDs centrales, pero los datos de negocio referencian la clínica por ID de
// negocio. Este helper resuelve, dentro del contexto de cliente, los IDs de
// negocio accesibles + los mapas para traducir en ambos sentidos.
//
// SOLO servidor. Debe correr dentro de runWithCliente(session.cliente).

import { base, TABLES, fetchAll, type Cliente } from "./airtable";
import { listClinicas, listClinicaIdsForUser } from "./auth/users";

export type NegocioClinicaScope = {
  /** IDs de clínica de NEGOCIO accesibles. null = admin (sin restricción). */
  ids: string[] | null;
  /** id de negocio → nombre de clínica. */
  nombreById: Map<string, string>;
  /** nombre de clínica → id CENTRAL (para remapear datos al espacio del UI). */
  centralIdByNombre: Map<string, string>;
};

export async function clinicasNegocioAccesibles(session: {
  userId: string;
  rol: string;
  cliente: Cliente;
}): Promise<NegocioClinicaScope> {
  const negocioRecs = await fetchAll(base(TABLES.clinics).select({ fields: ["Nombre"] }));
  const nombreById = new Map<string, string>();
  for (const r of negocioRecs) {
    nombreById.set(r.id, String((r.fields as Record<string, unknown>)?.["Nombre"] ?? ""));
  }

  const centralClinicas = await listClinicas({ cliente: session.cliente });
  const centralIdByNombre = new Map(centralClinicas.map((c) => [c.nombre, c.id]));

  if (session.rol === "admin") {
    return { ids: null, nombreById, centralIdByNombre };
  }

  const centralIds = await listClinicaIdsForUser(session.userId);
  const centralNombreById = new Map(centralClinicas.map((c) => [c.id, c.nombre]));
  const allowedNames = new Set(
    centralIds.map((id) => centralNombreById.get(id)).filter((n): n is string => !!n),
  );
  const ids = [...nombreById.entries()]
    .filter(([, n]) => allowedNames.has(n))
    .map(([id]) => id);
  return { ids, nombreById, centralIdByNombre };
}

/** id de negocio → id central (por nombre). Devuelve null si no resuelve. */
export function negocioIdToCentralId(
  scope: NegocioClinicaScope,
  negocioClinicaId: string | null,
): string | null {
  if (!negocioClinicaId) return null;
  const nombre = scope.nombreById.get(negocioClinicaId);
  if (!nombre) return null;
  return scope.centralIdByNombre.get(nombre) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — mini-dominio Clínicas de NEGOCIO (tabla "Clínicas"
// de la base de negocio; NO confundir con la Clínicas de identidad en la
// base CENTRAL, que va por baseCentral y migra con el módulo Identidad).
// Este archivo es el único punto de acceso a la tabla de negocio.
// ─────────────────────────────────────────────────────────────────────

/** Volcado con fields explícitos (lookup "Clínica ID"/"Nombre" del módulo
 *  no-shows ×9, selects de UI demo). Records crudos. */
export async function listClinicasNegocioCamposRaw(
  fields: string[],
  opts: { maxRecords?: number } = {},
): Promise<readonly any[]> {
  return base(TABLES.clinics as any)
    .select({ fields, ...(opts.maxRecords !== undefined ? { maxRecords: opts.maxRecords } : {}) })
    .all();
}
