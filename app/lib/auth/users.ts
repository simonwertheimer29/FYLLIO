// app/lib/auth/users.ts
//
// Repositorio de Usuarios (rol global: admin | coordinacion) + junction Usuario_Clinicas.
// Sprint 7: sistema canónico. NO tocar `Usuarios_Presupuestos` (legacy).

// Sprint B — Usuarios, Clínicas y Usuario_Clinicas son IDENTIDAD/REGISTRO y viven
// en la base CENTRAL. Todo este módulo usa baseCentral() (nunca base(), que es
// para datos de negocio por cliente).
import { baseCentral, TABLES, fetchAll, type Cliente } from "../airtable";
import { usaPostgresIdentidad } from "../db/data-backend";

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
 const pg = await import("./users-pg"); return pg.findUsersByEmailPg(email); 
}

/** Busca un admin por email. Devuelve null si no existe o no es admin activo. */
export async function findUserByEmail(email: string): Promise<Usuario | null> {
 const pg = await import("./users-pg"); return pg.findUserByEmailPg(email); 
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
 const pg = await import("./users-pg"); return pg.listClinicaIdsForUserPg(userId); 
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
 const pg = await import("./users-pg"); return pg.listClinicasPg(opts); 
}

export async function getUsuarioById(id: string): Promise<Usuario | null> {
 const pg = await import("./users-pg"); return pg.getUsuarioByIdPg(id); 
}

export async function listUsuarios(): Promise<Usuario[]> {
 const pg = await import("./users-pg"); return pg.listUsuariosPg(); 
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
 const pg = await import("./users-pg"); return pg.listUsuariosConClinicasPg(cliente); 
}

/** Admins activos con Pin_hash seteado (candidatos a admin-pin-login). */
export async function listAdminCandidates(): Promise<Usuario[]> {
 const pg = await import("./users-pg"); return pg.listAdminCandidatesPg(); 
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
 const pg = await import("./users-pg"); return pg.createUsuarioPg(args); 
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
 const pg = await import("./users-pg"); return pg.updateUsuarioPg(id, patch); 
}

/**
 * Reemplaza por completo las clínicas asociadas a un usuario:
 *  - Borra los registros de Usuario_Clinicas donde el usuario aparece y
 *    cuya clínica no esté en `clinicaIds`.
 *  - Crea los vínculos nuevos que falten.
 * Idempotente.
 */
export async function setUsuarioClinicas(userId: string, clinicaIds: string[]): Promise<void> {
 const pg = await import("./users-pg"); return pg.setUsuarioClinicasPg(userId, clinicaIds); 
}

/** Enlaza un usuario a una clínica (idempotente: no crea duplicados). */
export async function linkUsuarioClinica(userId: string, clinicaId: string): Promise<void> {
 const pg = await import("./users-pg"); return pg.linkUsuarioClinicaPg(userId, clinicaId); 
}

/** Elimina los vínculos de un usuario a una lista de clínicas. Usar con cuidado. */
export async function unlinkUsuarioFromClinicas(
  userId: string,
  clinicaIds: string[]
): Promise<void> {
  if (!clinicaIds.length) return;
 const pg = await import("./users-pg"); return pg.unlinkUsuarioFromClinicasPg(userId, clinicaIds); 
}

// ─────────────────────────────────────────────────────────────────────
// FASE 1 migración — accesos crudos a la tabla Clínicas de la base
// CENTRAL (identidad) para consumidores externos. NO confundir con la
// Clínicas de negocio (lib/clinicas-negocio.ts).
// ─────────────────────────────────────────────────────────────────────

export async function findClinicaCentralRaw(id: string): Promise<any> {
 const pg = await import("./users-pg"); return pg.findClinicaCentralRawPg(id); 
}

export async function selectClinicasCentralRaw(opts: {
  fields?: string[];
  filterByFormula?: string;
}): Promise<any[]> {
 const pg = await import("./users-pg"); return pg.selectClinicasCentralRawPg(opts); 
}

export async function createClinicaCentralRaw(fields: Record<string, unknown>): Promise<any> {
 const pg = await import("./users-pg"); return pg.createClinicaCentralRawPg(fields); 
}

export async function updateClinicaCentralRaw(id: string, fields: Record<string, unknown>): Promise<any> {
 const pg = await import("./users-pg"); return pg.updateClinicaCentralRawPg(id, fields); 
}
