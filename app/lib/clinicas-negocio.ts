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

import { runWithClienteDb } from "./db/context";
import { requireCliente, type Cliente } from "./cliente-contexto";
import { listClinicaIdsForUser } from "./auth/users";

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
  // MEJORAS 45 (2026-07-27) — esto leía la tabla Clínicas de Airtable SIN
  // pasar por el gate de backend y la cruzaba POR NOMBRE con los datos de
  // Postgres: una clínica creada solo en Postgres dejaba sus leads y pacientes
  // invisibles, sin error. En Postgres identidad y negocio comparten la MISMA
  // tabla `clinicas`, así que el puente por nombre desaparece: el id es el id.
  const filas = await runWithClienteDb(session.cliente, (trx) =>
    trx.selectFrom("clinicas").select(["id", "nombre"]).execute(),
  );
  const nombreById = new Map<string, string>();
  const centralIdByNombre = new Map<string, string>();
  for (const c of filas) {
    nombreById.set(c.id, c.nombre ?? "");
    centralIdByNombre.set(c.nombre ?? "", c.id);
  }

  if (session.rol === "admin") {
    return { ids: null, nombreById, centralIdByNombre };
  }

  const permitidas = await listClinicaIdsForUser(session.userId);
  const ids = [...nombreById.keys()].filter((id) => permitidas.includes(id));
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
  _fields: string[],
  opts: { maxRecords?: number } = {},
): Promise<readonly any[]> {
  const cliente = requireCliente("listClinicasNegocioCamposRaw");
  const filas = await runWithClienteDb(cliente, (trx) =>
    trx.selectFrom("clinicas").select(["id", "nombre", "clinica_id_airtable"]).execute(),
  );
  const recs = filas.map((c) => ({
    id: c.id,
    fields: { Nombre: c.nombre, "Clínica ID": c.clinica_id_airtable ?? c.id },
    get: (k: string) => (k === "Nombre" ? c.nombre : c.clinica_id_airtable ?? c.id),
  }));
  return opts.maxRecords !== undefined ? recs.slice(0, opts.maxRecords) : recs;
}
