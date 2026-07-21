// app/lib/auth/users-pg.ts — CORTE FASE A: identidad (Usuarios/Clínicas/Usuario_Clinicas) sobre Postgres.
//
// Dos modos de acceso (por RLS):
//  · `usuarios` tiene política p_identidad (using true) → se lee/escribe SIN
//    contexto de cliente (el login es cross-cliente). Vía getDb() directo.
//  · `clinicas` y `usuario_clinicas` son cliente-scoped (p_cliente) → SIEMPRE
//    dentro de runWithClienteDb(cliente). El cliente se deriva del usuario cuando
//    la firma no lo trae (login post-identify SÍ conoce el cliente del usuario).

import { sql } from "kysely";
import { getDb } from "../db/client";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import type { Usuario, Rol, Clinica } from "./users";

function rowToUsuario(r: any): Usuario {
  const rawLen = r.pin_length;
  const pinLength = rawLen === 4 || rawLen === 6 ? (rawLen as 4 | 6) : null;
  return {
    id: r.id,
    nombre: String(r.nombre ?? ""),
    email: r.email ? String(r.email) : null,
    telefono: r.telefono ? String(r.telefono) : null,
    rol: (String(r.rol ?? "coordinacion") as Rol),
    activo: Boolean(r.activo ?? false),
    passwordHash: r.password_hash ? String(r.password_hash) : null,
    pinHash: r.pin_hash ? String(r.pin_hash) : null,
    pinLength,
    cliente: r.cliente === "RB" || r.cliente === "INDEP" || r.cliente === "DEMO" ? (r.cliente as Cliente) : null,
  };
}
function rowToClinica(r: any): Clinica {
  return {
    id: r.id,
    nombre: String(r.nombre ?? ""),
    ciudad: r.ciudad ? String(r.ciudad) : null,
    telefono: r.telefono ? String(r.telefono) : null,
    activa: Boolean(r.activa ?? false),
  };
}
/** Shim record-Airtable de una clínica (para los *Raw que leen fields crudos). */
function clinicaShim(r: any): any {
  const f: Record<string, unknown> = {
    "Nombre": r.nombre, "Ciudad": r.ciudad, "Activa": r.activa,
    "Cliente": r.cliente, "Clínica ID": r.clinica_id_airtable,
  };
  for (const k of Object.keys(f)) if (f[k] === undefined || f[k] === null || f[k] === "") delete f[k];
  return { id: r.id, fields: f, get: (k: string) => f[k] };
}

const norm = (s: string) => s.toLowerCase().trim();

/** cliente al que pertenece un usuario (usuarios es using-true → sin contexto). */
async function clienteDeUsuario(userId: string): Promise<Cliente | null> {
  const r = await getDb().selectFrom("usuarios").select("cliente").where("id", "=", userId).executeTakeFirst();
  const c = (r as any)?.cliente;
  return c === "RB" || c === "INDEP" || c === "DEMO" ? c : null;
}

// ── Reads SIN contexto (usuarios, using-true) ──────────────────────────
export async function findUsersByEmailPg(email: string): Promise<Usuario[]> {
  const safe = norm(email);
  if (!safe) return [];
  const rows = await getDb().selectFrom("usuarios").selectAll()
    .where(sql<string>`lower(email)`, "=", safe).where("activo", "=", true).limit(10).execute();
  return rows.map(rowToUsuario);
}
export async function findUserByEmailPg(email: string): Promise<Usuario | null> {
  const safe = norm(email);
  const r = await getDb().selectFrom("usuarios").selectAll()
    .where(sql<string>`lower(email)`, "=", safe).where("rol", "=", "admin").where("activo", "=", true).limit(1).executeTakeFirst();
  return r ? rowToUsuario(r) : null;
}
export async function getUsuarioByIdPg(id: string): Promise<Usuario | null> {
  const r = await getDb().selectFrom("usuarios").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? rowToUsuario(r) : null;
}
export async function listUsuariosPg(): Promise<Usuario[]> {
  const rows = await getDb().selectFrom("usuarios").selectAll().execute();
  return rows.map(rowToUsuario);
}
export async function listAdminCandidatesPg(): Promise<Usuario[]> {
  const rows = await getDb().selectFrom("usuarios").selectAll()
    .where("rol", "=", "admin").where("activo", "=", true).where("pin_hash", "is not", null).execute();
  return rows.map(rowToUsuario).filter((u) => u.pinHash);
}
export async function createUsuarioPg(args: {
  nombre: string; rol: Rol; cliente: Cliente; email?: string | null; telefono?: string | null;
  passwordHash?: string | null; pinHash?: string | null; pinLength?: 4 | 6; activo?: boolean;
}): Promise<Usuario> {
  const row: Record<string, unknown> = {
    cliente: args.cliente, nombre: args.nombre, rol: args.rol, activo: args.activo ?? true,
    email: args.email ? norm(args.email) : null, telefono: args.telefono?.trim() ?? null,
    password_hash: args.passwordHash ?? null, pin_hash: args.pinHash ?? null, pin_length: args.pinLength ?? null,
  };
  const r = await getDb().insertInto("usuarios").values(row as any).returningAll().executeTakeFirstOrThrow();
  return rowToUsuario(r);
}
export async function updateUsuarioPg(id: string, patch: Record<string, any>): Promise<Usuario> {
  const set: Record<string, unknown> = {};
  if (patch.nombre !== undefined) set.nombre = patch.nombre;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.telefono !== undefined) set.telefono = patch.telefono ?? "";
  if (patch.passwordHash !== undefined) set.password_hash = patch.passwordHash;
  if (patch.pinHash !== undefined) set.pin_hash = patch.pinHash;
  if (patch.pinLength !== undefined) set.pin_length = patch.pinLength;
  if (patch.activo !== undefined) set.activo = patch.activo;
  const r = await getDb().updateTable("usuarios").set(set as any).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  return rowToUsuario(r);
}

// ── Reads/writes cliente-scoped (clinicas, usuario_clinicas) ───────────
export async function listClinicaIdsForUserPg(userId: string): Promise<string[]> {
  const cliente = await clienteDeUsuario(userId);
  if (!cliente) return [];
  return runWithClienteDb(cliente, async (trx) => {
    const rows = await trx.selectFrom("usuario_clinicas").select("clinica_id").where("usuario_id", "=", userId).execute();
    return [...new Set(rows.map((r) => r.clinica_id).filter(Boolean))] as string[];
  });
}
export async function listClinicasPg(opts: { onlyActivas?: boolean; cliente?: Cliente } = {}): Promise<Clinica[]> {
  if (!opts.cliente) {
    // sin cliente: solo el login clínica-primero (retirado); vía la vista D7a sin contexto.
    const { sql } = await import("kysely");
    const r: any = await sql.raw(`select id, cliente, nombre, ciudad, activa from login_clinicas_directorio${opts.onlyActivas ? " where activa = true" : ""}`).execute(getDb());
    return (r.rows as any[]).map((x) => ({ id: x.id, nombre: String(x.nombre ?? ""), ciudad: x.ciudad ?? null, telefono: null, activa: Boolean(x.activa) }));
  }
  return runWithClienteDb(opts.cliente, async (trx) => {
    let q = trx.selectFrom("clinicas").selectAll();
    if (opts.onlyActivas) q = q.where("activa", "=", true);
    const rows = await q.execute();
    return rows.map(rowToClinica);
  });
}
export async function listUsuariosConClinicasPg(cliente?: Cliente): Promise<Array<Usuario & { clinicas: Array<{ id: string; nombre: string }> }>> {
  const usuariosAll = await listUsuariosPg();
  const usuarios = cliente ? usuariosAll.filter((u) => u.cliente === cliente) : usuariosAll;
  // junction + clínicas del cliente (cliente-scoped). Si no hay cliente, no se puede
  // resolver la junction cross-cliente sobre PG → clínicas vacías (paridad razonable
  // con el uso real: /ajustes SIEMPRE pasa el cliente del admin).
  if (!cliente) return usuarios.map((u) => ({ ...u, clinicas: [] }));
  return runWithClienteDb(cliente, async (trx) => {
    const [clinicas, junctions] = await Promise.all([
      trx.selectFrom("clinicas").select(["id", "nombre"]).execute(),
      trx.selectFrom("usuario_clinicas").select(["usuario_id", "clinica_id"]).execute(),
    ]);
    const clinicaById = new Map(clinicas.map((c) => [c.id, c]));
    const byUser = new Map<string, Array<{ id: string; nombre: string }>>();
    for (const j of junctions) {
      if (!byUser.has(j.usuario_id)) byUser.set(j.usuario_id, []);
      const c = clinicaById.get(j.clinica_id);
      if (c) byUser.get(j.usuario_id)!.push({ id: c.id, nombre: c.nombre ?? "" });
    }
    return usuarios.map((u) => ({ ...u, clinicas: u.rol === "admin" ? [] : byUser.get(u.id) ?? [] }));
  });
}
export async function setUsuarioClinicasPg(userId: string, clinicaIds: string[]): Promise<void> {
  const cliente = await clienteDeUsuario(userId);
  if (!cliente) throw new Error("[users-pg] setUsuarioClinicas: usuario sin cliente");
  await runWithClienteDb(cliente, async (trx) => {
    await trx.deleteFrom("usuario_clinicas").where("usuario_id", "=", userId).execute();
    for (const cid of [...new Set(clinicaIds)]) {
      await trx.insertInto("usuario_clinicas").values({ cliente, usuario_id: userId, clinica_id: cid } as any).execute();
    }
  });
}
export async function linkUsuarioClinicaPg(userId: string, clinicaId: string): Promise<void> {
  const cliente = await clienteDeUsuario(userId);
  if (!cliente) throw new Error("[users-pg] linkUsuarioClinica: usuario sin cliente");
  await runWithClienteDb(cliente, async (trx) => {
    const existe = await trx.selectFrom("usuario_clinicas").select("id").where("usuario_id", "=", userId).where("clinica_id", "=", clinicaId).executeTakeFirst();
    if (!existe) await trx.insertInto("usuario_clinicas").values({ cliente, usuario_id: userId, clinica_id: clinicaId } as any).execute();
  });
}
export async function unlinkUsuarioFromClinicasPg(userId: string, clinicaIds: string[]): Promise<void> {
  if (!clinicaIds.length) return;
  const cliente = await clienteDeUsuario(userId);
  if (!cliente) return;
  await runWithClienteDb(cliente, (trx) =>
    trx.deleteFrom("usuario_clinicas").where("usuario_id", "=", userId).where("clinica_id", "in", clinicaIds).execute());
}

// ── Clínicas *Raw (fields crudos) — cliente del contexto actual ────────
function cliCtx(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[users-pg] acceso a clínica central sin cliente en contexto (fail-closed)");
  return c;
}
export async function findClinicaCentralRawPg(id: string): Promise<any> {
  return runWithClienteDb(cliCtx(), async (trx) => {
    const r = await trx.selectFrom("clinicas").selectAll().where("id", "=", id).executeTakeFirst();
    if (!r) throw new Error(`clínica no encontrada: ${id}`);
    return clinicaShim(r);
  });
}
export async function selectClinicasCentralRawPg(_opts: { fields?: string[]; filterByFormula?: string }): Promise<any[]> {
  return runWithClienteDb(cliCtx(), async (trx) => {
    const rows = await trx.selectFrom("clinicas").selectAll().execute();
    return rows.map(clinicaShim);
  });
}
export async function createClinicaCentralRawPg(fields: Record<string, unknown>): Promise<any> {
  const row: Record<string, unknown> = {
    cliente: cliCtx(), nombre: fields["Nombre"] == null ? null : String(fields["Nombre"]),
    ciudad: fields["Ciudad"] == null ? null : String(fields["Ciudad"]),
    activa: fields["Activa"] === undefined ? true : Boolean(fields["Activa"]),
    clinica_id_airtable: fields["Clínica ID"] == null ? null : String(fields["Clínica ID"]),
  };
  return runWithClienteDb(cliCtx(), async (trx) => {
    const r = await trx.insertInto("clinicas").values(row as any).returningAll().executeTakeFirstOrThrow();
    return clinicaShim(r);
  });
}
export async function updateClinicaCentralRawPg(id: string, fields: Record<string, unknown>): Promise<any> {
  const set: Record<string, unknown> = {};
  if (fields["Nombre"] !== undefined) set.nombre = fields["Nombre"];
  if (fields["Ciudad"] !== undefined) set.ciudad = fields["Ciudad"];
  if (fields["Activa"] !== undefined) set.activa = Boolean(fields["Activa"]);
  return runWithClienteDb(cliCtx(), async (trx) => {
    const r = await trx.updateTable("clinicas").set(set as any).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
    return clinicaShim(r);
  });
}
