// app/lib/auth/users.ts
//
// Repositorio de Usuarios (rol global: admin | coordinacion) + junction Usuario_Clinicas.
// Sprint 7: sistema canónico. NO tocar `Usuarios_Presupuestos` (legacy).

// Sprint B — Usuarios, Clínicas y Usuario_Clinicas son IDENTIDAD/REGISTRO y viven
// en la base CENTRAL. Todo este módulo usa baseCentral() (nunca base(), que es
// para datos de negocio por cliente).
import { baseCentral, TABLES, fetchAll, type Cliente } from "../airtable";

export type Rol = "admin" | "coordinacion";

export type Usuario = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  rol: Rol;
  activo: boolean;
  passwordHash: string | null;
  pinHash: string | null;
  /** 4 para coordinación, 6 para admin. null si aún no se ha migrado. */
  pinLength: 4 | 6 | null;
  /** Sprint B — cliente legal al que pertenece el usuario (Usuarios.Cliente).
   *  Determina la base de negocio. null si aún no se ha asignado. */
  cliente: Cliente | null;
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
    telefono: f["Telefono"] ? String(f["Telefono"]) : null,
    rol: (String(f["Rol"] ?? "coordinacion") as Rol),
    activo: Boolean(f["Activo"] ?? false),
    passwordHash: f["Password_hash"] ? String(f["Password_hash"]) : null,
    pinHash: f["Pin_hash"] ? String(f["Pin_hash"]) : null,
    pinLength,
    cliente:
      f["Cliente"] === "RB" || f["Cliente"] === "INDEP" || f["Cliente"] === "DEMO"
        ? (f["Cliente"] as Cliente)
        : null,
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
  // La barra invertida es el carácter de escape de las fórmulas Airtable:
  // hay que escaparla ANTES que la comilla, o un `\'` del atacante anularía
  // el escape de la comilla y rompería fuera del literal de cadena.
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Email válido como identificador de login: sin espacios, comillas ni barras
// invertidas (que romperían la fórmula Airtable), formato local@dominio.tld.
const LOGIN_EMAIL_RE = /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/;

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function isValidLoginEmail(email: string): boolean {
  return email.length <= 254 && LOGIN_EMAIL_RE.test(email);
}

/**
 * ¿Existe ya OTRO usuario ACTIVO con este email? La comprobación es GLOBAL
 * (todos los clientes), no por cliente: el login por email compara el PIN
 * contra todos los usuarios activos con ese email sin filtrar por cliente, así
 * que dos usuarios de clientes distintos compartiendo email harían el acceso
 * ambiguo entre inquilinos. `excludeUserId` omite al usuario que se edita.
 */
export async function emailInUse(email: string, excludeUserId?: string): Promise<boolean> {
  const matches = await findUsersByEmail(email);
  return matches.some((u) => u.id !== excludeUserId);
}

/**
 * Login email+PIN — usuarios ACTIVOS (cualquier rol) con ese email.
 * `Email` no es único en Airtable, así que devuelve todos los candidatos y
 * el caller compara el PIN (bcrypt) contra cada uno, igual que hace el
 * flujo de coordinación por clínica.
 */
export async function findUsersByEmail(email: string): Promise<Usuario[]> {
  const safe = escapeFormula(email.toLowerCase().trim());
  if (!safe) return [];
  const recs = await baseCentral(TABLES.usuarios)
    .select({
      filterByFormula: `AND(LOWER({Email})='${safe}', {Activo})`,
      maxRecords: 10,
    })
    .firstPage();
  return recs.map(toUsuario);
}

/** Busca un admin por email. Devuelve null si no existe o no es admin activo. */
export async function findUserByEmail(email: string): Promise<Usuario | null> {
  const safe = escapeFormula(email.toLowerCase().trim());
  const recs = await baseCentral(TABLES.usuarios)
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
  const recs = await fetchAll(baseCentral(TABLES.usuarioClinicas).select({}));
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
    baseCentral(TABLES.usuarios).select({
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

/**
 * Lista clínicas del registro central. Sprint B Fase 4: `cliente` restringe a las
 * clínicas de ESE cliente (para que un admin de RB no vea las de INDEP en el
 * selector). Sin `cliente` devuelve todas (solo el login clinic-first, pre-auth,
 * lo usa así). Los contextos autenticados SIEMPRE pasan el cliente de la sesión.
 */
export async function listClinicas(
  opts: { onlyActivas?: boolean; cliente?: Cliente } = {},
): Promise<Clinica[]> {
  const parts: string[] = [];
  if (opts.onlyActivas) parts.push("{Activa}");
  if (opts.cliente) parts.push(`{Cliente}='${opts.cliente}'`);
  const filter = parts.length === 0 ? "" : parts.length === 1 ? parts[0] : `AND(${parts.join(",")})`;
  const recs = await fetchAll(
    baseCentral(TABLES.clinics).select(filter ? { filterByFormula: filter } : {})
  );
  return recs.map(toClinica);
}

export async function getUsuarioById(id: string): Promise<Usuario | null> {
  try {
    const rec = await baseCentral(TABLES.usuarios).find(id);
    return toUsuario(rec);
  } catch {
    return null;
  }
}

export async function listUsuarios(): Promise<Usuario[]> {
  const recs = await fetchAll(baseCentral(TABLES.usuarios).select({}));
  return recs.map(toUsuario);
}

/**
 * Lista usuarios junto con sus clínicas embebidas. Uso: Fase 6 /ajustes.
 * Resuelve el junction en un solo round-trip y devuelve
 * `[{...usuario, clinicas: [{id, nombre}]}]`.
 * Los admin aparecen con `clinicas: []` (acceso a todas via rol).
 */
export async function listUsuariosConClinicas(cliente?: Cliente): Promise<
  Array<Usuario & { clinicas: Array<{ id: string; nombre: string }> }>
> {
  const [usuariosAll, allClinicas, junctions] = await Promise.all([
    listUsuarios(),
    listClinicas({ cliente }),
    allJunctions(),
  ]);
  // Fase 4 — solo los usuarios del cliente del admin (no los de otro cliente).
  const usuarios = cliente ? usuariosAll.filter((u) => u.cliente === cliente) : usuariosAll;
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
    baseCentral(TABLES.usuarios).select({
      filterByFormula: `AND({Rol}='admin', {Activo}, {Pin_hash}!='')`,
    })
  );
  return recs.map(toUsuario);
}

/** Crea un usuario. No hashea — el caller pasa hashes ya calculados. */
export async function createUsuario(args: {
  nombre: string;
  rol: Rol;
  /** Sprint B Fase 4 — cliente del usuario (obligatorio: sin él no puede entrar
   *  ni resolver su base). El caller pasa el cliente del admin que lo crea. */
  cliente: Cliente;
  email?: string | null;
  telefono?: string | null;
  passwordHash?: string | null;
  pinHash?: string | null;
  pinLength?: 4 | 6;
  activo?: boolean;
}): Promise<Usuario> {
  const fields: Record<string, any> = {
    Nombre: args.nombre,
    Rol: args.rol,
    Activo: args.activo ?? true,
    Cliente: args.cliente,
  };
  if (args.email) fields["Email"] = args.email.toLowerCase().trim();
  if (args.telefono) fields["Telefono"] = args.telefono.trim();
  if (args.passwordHash) fields["Password_hash"] = args.passwordHash;
  if (args.pinHash) fields["Pin_hash"] = args.pinHash;
  if (args.pinLength) fields["Pin_length"] = args.pinLength;

  const created = (await baseCentral(TABLES.usuarios).create([{ fields }]))[0];
  return toUsuario(created);
}

export async function updateUsuario(
  id: string,
  patch: Partial<{
    nombre: string;
    email: string | null;
    telefono: string | null;
    passwordHash: string | null;
    pinHash: string | null;
    pinLength: 4 | 6;
    activo: boolean;
  }>
): Promise<Usuario> {
  const fields: Record<string, any> = {};
  if (patch.nombre !== undefined) fields["Nombre"] = patch.nombre;
  if (patch.email !== undefined) fields["Email"] = patch.email;
  if (patch.telefono !== undefined) fields["Telefono"] = patch.telefono ?? "";
  if (patch.passwordHash !== undefined) fields["Password_hash"] = patch.passwordHash;
  if (patch.pinHash !== undefined) fields["Pin_hash"] = patch.pinHash;
  if (patch.pinLength !== undefined) fields["Pin_length"] = patch.pinLength;
  if (patch.activo !== undefined) fields["Activo"] = patch.activo;

  const updated = (await baseCentral(TABLES.usuarios).update([{ id, fields }]))[0];
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
  const recs = await fetchAll(baseCentral(TABLES.usuarioClinicas).select({}));
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
    await baseCentral(TABLES.usuarioClinicas).destroy(toDelete.slice(i, i + 10));
  }
  // Crear los que faltan.
  const missing = clinicaIds.filter((cid) => !keep.has(cid));
  const toCreate = missing.map((cid) => ({
    fields: { Usuario: [userId], Clinica: [cid] },
  }));
  for (let i = 0; i < toCreate.length; i += 10) {
    await baseCentral(TABLES.usuarioClinicas).create(toCreate.slice(i, i + 10));
  }
}

/** Enlaza un usuario a una clínica (idempotente: no crea duplicados). */
export async function linkUsuarioClinica(userId: string, clinicaId: string): Promise<void> {
  const junctions = await allJunctions();
  const exists = junctions.some(
    (j) => j.userIds.includes(userId) && j.clinicaIds.includes(clinicaId)
  );
  if (exists) return;
  await baseCentral(TABLES.usuarioClinicas).create([
    { fields: { Usuario: [userId], Clinica: [clinicaId] } },
  ]);
}

/** Elimina los vínculos de un usuario a una lista de clínicas. Usar con cuidado. */
export async function unlinkUsuarioFromClinicas(
  userId: string,
  clinicaIds: string[]
): Promise<void> {
  if (!clinicaIds.length) return;
  const recs = await fetchAll(baseCentral(TABLES.usuarioClinicas).select({}));
  const toDelete: string[] = [];
  for (const rec of recs) {
    const userLinks = (rec.fields?.["Usuario"] ?? []) as string[];
    if (!userLinks.includes(userId)) continue;
    const clinicaLinks = (rec.fields?.["Clinica"] ?? []) as string[];
    if (clinicaLinks.some((cid) => clinicaIds.includes(cid))) toDelete.push(rec.id);
  }
  if (!toDelete.length) return;
  for (let i = 0; i < toDelete.length; i += 10) {
    await baseCentral(TABLES.usuarioClinicas).destroy(toDelete.slice(i, i + 10));
  }
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — accesos crudos a la tabla Clínicas de la base
// CENTRAL (identidad) para consumidores externos. NO confundir con la
// Clínicas de negocio (lib/clinicas-negocio.ts).
// ─────────────────────────────────────────────────────────────────────

export async function findClinicaCentralRaw(id: string): Promise<any> {
  return baseCentral(TABLES.clinics as any).find(id);
}

export async function selectClinicasCentralRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
}): Promise<any[]> {
  return fetchAll(baseCentral(TABLES.clinics as any).select(opts as any));
}

export async function createClinicaCentralRaw(fields: Record<string, unknown>): Promise<any> {
  return (await baseCentral(TABLES.clinics).create([{ fields } as any]))[0]!;
}

export async function updateClinicaCentralRaw(id: string, fields: Record<string, unknown>): Promise<any> {
  return (await baseCentral(TABLES.clinics).update([{ id, fields } as any]))[0]!;
}
