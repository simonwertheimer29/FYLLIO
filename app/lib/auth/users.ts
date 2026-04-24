// app/lib/auth/users.ts
//
// Repositorio de Usuarios (rol global: admin | coordinacion) + junction Usuario_Clinicas.
// Sprint 7: sistema canónico. NO tocar `Usuarios_Presupuestos` (legacy).

import { base, TABLES, fetchAll } from "../airtable";

export type Rol = "admin" | "coordinacion";

export type Usuario = {
  id: string;
  nombre: string;
  email: string | null;
  rol: Rol;
  activo: boolean;
  passwordHash: string | null;
  pinHash: string | null;
  /** 4 para coordinación, 6 para admin. null si aún no se ha migrado. */
  pinLength: 4 | 6 | null;
};

export type Clinica = {
  id: string;
  nombre: string;
  ciudad: string | null;
  telefono: string | null;
  activa: boolean;
};

function toUsuario(rec: any): Usuario {
  const f = rec.fields ?? {};
  const rawLen = f["Pin_length"];
  const pinLength = rawLen === 4 || rawLen === 6 ? (rawLen as 4 | 6) : null;
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    email: f["Email"] ? String(f["Email"]) : null,
    rol: (String(f["Rol"] ?? "coordinacion") as Rol),
    activo: Boolean(f["Activo"] ?? false),
    passwordHash: f["Password_hash"] ? String(f["Password_hash"]) : null,
    pinHash: f["Pin_hash"] ? String(f["Pin_hash"]) : null,
    pinLength,
  };
}

function toClinica(rec: any): Clinica {
  const f = rec.fields ?? {};
  return {
    id: rec.id,
    nombre: String(f["Nombre"] ?? ""),
    ciudad: f["Ciudad"] ? String(f["Ciudad"]) : null,
    telefono: f["Telefono"] ? String(f["Telefono"]) : null,
    activa: Boolean(f["Activa"] ?? false),
  };
}

function escapeFormula(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** Busca un admin por email. Devuelve null si no existe o no es admin activo. */
export async function findUserByEmail(email: string): Promise<Usuario | null> {
  const safe = escapeFormula(email.toLowerCase().trim());
  const recs = await base(TABLES.usuarios)
    .select({
      filterByFormula: `AND({Email}='${safe}', {Rol}='admin', {Activo})`,
      maxRecords: 1,
    })
    .firstPage();
  if (!recs.length) return null;
  return toUsuario(recs[0]);
}

// NOTA: Airtable `filterByFormula` con FIND/ARRAYJOIN sobre link fields compara
// contra el primary field del target (Nombre), NO contra record IDs. Para filtrar
// por record ID hay que traer todos los registros y filtrar en memoria sobre el
// array de IDs que devuelve el campo. La junction Usuario_Clinicas tiene volumen
// reducido (# usuarios × # clínicas), así que es aceptable.

/** Devuelve todos los junction records (usado para filtrado en memoria). */
async function allJunctions(): Promise<Array<{ userIds: string[]; clinicaIds: string[] }>> {
  const recs = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  return recs.map((r) => ({
    userIds: (r.fields?.["Usuario"] ?? []) as string[],
    clinicaIds: (r.fields?.["Clinica"] ?? []) as string[],
  }));
}

/**
 * Busca coordinaciones activas vinculadas a `clinicaId` vía Usuario_Clinicas.
 * Devuelve todas las candidatas — el caller compara el PIN con bcrypt.
 */
export async function findCoordinacionesByClinica(clinicaId: string): Promise<Usuario[]> {
  const junctions = await allJunctions();
  const userIds = new Set<string>();
  for (const j of junctions) {
    if (j.clinicaIds.includes(clinicaId)) {
      for (const uid of j.userIds) userIds.add(uid);
    }
  }
  if (userIds.size === 0) return [];

  const usersAll = await fetchAll(
    base(TABLES.usuarios).select({
      filterByFormula: `AND({Rol}='coordinacion', {Activo})`,
    })
  );
  return usersAll.filter((r) => userIds.has(r.id)).map(toUsuario);
}

/** IDs de clínicas (Airtable record ids) accesibles por un usuario (vía junction). */
export async function listClinicaIdsForUser(userId: string): Promise<string[]> {
  const junctions = await allJunctions();
  const ids = new Set<string>();
  for (const j of junctions) {
    if (j.userIds.includes(userId)) {
      for (const cid of j.clinicaIds) ids.add(cid);
    }
  }
  return Array.from(ids);
}

export async function listClinicas(opts: { onlyActivas?: boolean } = {}): Promise<Clinica[]> {
  const filter = opts.onlyActivas ? "{Activa}" : "";
  const recs = await fetchAll(
    base(TABLES.clinics).select(filter ? { filterByFormula: filter } : {})
  );
  return recs.map(toClinica);
}

export async function getUsuarioById(id: string): Promise<Usuario | null> {
  try {
    const rec = await base(TABLES.usuarios).find(id);
    return toUsuario(rec);
  } catch {
    return null;
  }
}

export async function listUsuarios(): Promise<Usuario[]> {
  const recs = await fetchAll(base(TABLES.usuarios).select({}));
  return recs.map(toUsuario);
}

/**
 * Lista usuarios junto con sus clínicas embebidas. Uso: Fase 6 /ajustes.
 * Resuelve el junction en un solo round-trip y devuelve
 * `[{...usuario, clinicas: [{id, nombre}]}]`.
 * Los admin aparecen con `clinicas: []` (acceso a todas via rol).
 */
export async function listUsuariosConClinicas(): Promise<
  Array<Usuario & { clinicas: Array<{ id: string; nombre: string }> }>
> {
  const [usuarios, allClinicas, junctions] = await Promise.all([
    listUsuarios(),
    listClinicas(),
    allJunctions(),
  ]);
  const clinicaById = new Map(allClinicas.map((c) => [c.id, c]));
  const clinicasByUserId = new Map<string, Array<{ id: string; nombre: string }>>();
  for (const j of junctions) {
    for (const uid of j.userIds) {
      if (!clinicasByUserId.has(uid)) clinicasByUserId.set(uid, []);
      for (const cid of j.clinicaIds) {
        const c = clinicaById.get(cid);
        if (c) clinicasByUserId.get(uid)!.push({ id: c.id, nombre: c.nombre });
      }
    }
  }
  return usuarios.map((u) => ({
    ...u,
    clinicas: u.rol === "admin" ? [] : clinicasByUserId.get(u.id) ?? [],
  }));
}

/** Admins activos con Pin_hash seteado (candidatos a admin-pin-login). */
export async function listAdminCandidates(): Promise<Usuario[]> {
  const recs = await fetchAll(
    base(TABLES.usuarios).select({
      filterByFormula: `AND({Rol}='admin', {Activo}, {Pin_hash}!='')`,
    })
  );
  return recs.map(toUsuario);
}

/** Crea un usuario. No hashea — el caller pasa hashes ya calculados. */
export async function createUsuario(args: {
  nombre: string;
  rol: Rol;
  email?: string | null;
  passwordHash?: string | null;
  pinHash?: string | null;
  pinLength?: 4 | 6;
  activo?: boolean;
}): Promise<Usuario> {
  const fields: Record<string, any> = {
    Nombre: args.nombre,
    Rol: args.rol,
    Activo: args.activo ?? true,
  };
  if (args.email) fields["Email"] = args.email.toLowerCase().trim();
  if (args.passwordHash) fields["Password_hash"] = args.passwordHash;
  if (args.pinHash) fields["Pin_hash"] = args.pinHash;
  if (args.pinLength) fields["Pin_length"] = args.pinLength;

  const created = (await base(TABLES.usuarios).create([{ fields }]))[0];
  return toUsuario(created);
}

export async function updateUsuario(
  id: string,
  patch: Partial<{
    nombre: string;
    email: string | null;
    passwordHash: string | null;
    pinHash: string | null;
    pinLength: 4 | 6;
    activo: boolean;
  }>
): Promise<Usuario> {
  const fields: Record<string, any> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.email !== undefined) fields["Email"] = patch.email;
  if (patch.passwordHash !== undefined) fields["Password_hash"] = patch.passwordHash;
  if (patch.pinHash !== undefined) fields["Pin_hash"] = patch.pinHash;
  if (patch.pinLength !== undefined) fields["Pin_length"] = patch.pinLength;
  if (patch.activo !== undefined) fields["Activo"] = patch.activo;

  const updated = (await base(TABLES.usuarios).update([{ id, fields }]))[0];
  return toUsuario(updated);
}

/**
 * Reemplaza por completo las clínicas asociadas a un usuario:
 *  - Borra los registros de Usuario_Clinicas donde el usuario aparece y
 *    cuya clínica no esté en `clinicaIds`.
 *  - Crea los vínculos nuevos que falten.
 * Idempotente.
 */
export async function setUsuarioClinicas(userId: string, clinicaIds: string[]): Promise<void> {
  const target = new Set(clinicaIds);
  const recs = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  const toDelete: string[] = [];
  const keep = new Set<string>();
  for (const rec of recs) {
    const userLinks = (rec.fields?.["Usuario"] ?? []) as string[];
    if (!userLinks.includes(userId)) continue;
    const clinicaLinks = (rec.fields?.["Clinica"] ?? []) as string[];
    // Junction con ambos lados single-link (lo creamos así); asumimos clinicaLinks[0].
    const cid = clinicaLinks[0];
    if (!cid || !target.has(cid)) {
      toDelete.push(rec.id);
    } else {
      keep.add(cid);
    }
  }
  // Borrar sobrantes en batches de 10.
  for (let i = 0; i < toDelete.length; i += 10) {
    await base(TABLES.usuarioClinicas).destroy(toDelete.slice(i, i + 10));
  }
  // Crear los que faltan.
  const missing = clinicaIds.filter((cid) => !keep.has(cid));
  const toCreate = missing.map((cid) => ({
    fields: { Usuario: [userId], Clinica: [cid] },
  }));
  for (let i = 0; i < toCreate.length; i += 10) {
    await base(TABLES.usuarioClinicas).create(toCreate.slice(i, i + 10));
  }
}

/** Enlaza un usuario a una clínica (idempotente: no crea duplicados). */
export async function linkUsuarioClinica(userId: string, clinicaId: string): Promise<void> {
  const junctions = await allJunctions();
  const exists = junctions.some(
    (j) => j.userIds.includes(userId) && j.clinicaIds.includes(clinicaId)
  );
  if (exists) return;
  await base(TABLES.usuarioClinicas).create([
    { fields: { Usuario: [userId], Clinica: [clinicaId] } },
  ]);
}

/** Elimina los vínculos de un usuario a una lista de clínicas. Usar con cuidado. */
export async function unlinkUsuarioFromClinicas(
  userId: string,
  clinicaIds: string[]
): Promise<void> {
  if (!clinicaIds.length) return;
  const recs = await fetchAll(base(TABLES.usuarioClinicas).select({}));
  const toDelete: string[] = [];
  for (const rec of recs) {
    const userLinks = (rec.fields?.["Usuario"] ?? []) as string[];
    if (!userLinks.includes(userId)) continue;
    const clinicaLinks = (rec.fields?.["Clinica"] ?? []) as string[];
    if (clinicaLinks.some((cid) => clinicaIds.includes(cid))) toDelete.push(rec.id);
  }
  if (!toDelete.length) return;
  for (let i = 0; i < toDelete.length; i += 10) {
    await base(TABLES.usuarioClinicas).destroy(toDelete.slice(i, i + 10));
  }
}
