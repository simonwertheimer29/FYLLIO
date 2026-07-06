// app/lib/airtable.ts
import Airtable from "airtable";
import { AsyncLocalStorage } from "node:async_hooks";

export const TABLES = {
  waitlist: "Lista_de_espera",
  clinics: "Clínicas",
  patients: "Pacientes",
  treatments: "Tratamientos",
  staff: "Staff",
  appointments: "Citas",
  sillones: "Sillones",
  // Módulo presupuestos
  presupuestos: "Presupuestos",
  contactosPresupuesto: "Contactos_Presupuesto",
  doctoresPresupuestos: "Doctores_Presupuestos",
  usuariosPresupuestos: "Usuarios_Presupuestos",
  objetivosMensuales: "Objetivos_Mensuales",
  // Módulo automatizaciones
  secuenciasAutomaticas: "Secuencias_Automaticas",
  configuracionAutomatizaciones: "Configuracion_Automatizaciones",
  // Web Push
  pushSubscriptions: "Push_Subscriptions",
  // Historial de acciones
  historialAcciones: "Historial_Acciones",
  // Informes guardados (mensuales + semanales automáticos)
  informesGuardados: "Informes_Guardados",
  // Mensajes WhatsApp
  mensajesWhatsApp: "Mensajes_WhatsApp",
  // Plantillas y cola de envíos
  plantillasMensaje: "Plantillas_Mensaje",
  configuracionRecordatorios: "Configuracion_Recordatorios",
  colaEnvios: "Cola_Envios",
  // Notificaciones in-app
  notificaciones: "Notificaciones",
  // WABA operational config (solo datos operativos; credenciales viven en env vars)
  configuracionWABA: "Configuracion_WABA",
  // Sprint 7 — roles globales (nuevo sistema; `usuariosPresupuestos` queda legacy)
  usuarios: "Usuarios",
  usuarioClinicas: "Usuario_Clinicas",
  // Sprint 8 — módulo Leads (pipeline comercial pre-paciente)
  leads: "Leads",
  // Sprint 8 — log de alertas enviadas por admin (cooldown 2h)
  alertasEnviadas: "Alertas_Enviadas",
  // Sprint 10 C — log estructurado de acciones sobre leads (KPI tiempo medio)
  accionesLead: "Acciones_Lead",
  // Sprint 10 D — plantillas WhatsApp para leads (globales)
  plantillasLead: "Plantillas_Lead",
  // Sprint 13.1 Bloque 0 — log estructurado de pagos de paciente
  pagosPaciente: "Pagos_Paciente",
  // Sprint 14a Bloque 6 — auditoria CRUD pagos + log inconsistencias cache
  accionesPago: "Acciones_Pago",
  inconsistenciasPagos: "Inconsistencias_Pagos",
  // Sprint 14b Bloque 0 — configuracion por clinica
  configuracionesClinica: "Configuraciones_Clinica",
  // Sprint 16a Bloque 1 — memoria persistente del Copilot
  conversacionesCopilot: "Conversaciones_Copilot",
  // Sprint 16b Bloque 1 — motor de automatizaciones
  reglasAutomatizacion: "Reglas_Automatizacion",
  accionesAutomatizacion: "Acciones_Automatizacion",
  eventosSistema: "Eventos_Sistema",
  // Sprint 17 Bloque 1 — Voice IA con Vapi
  llamadasVapi: "Llamadas_Vapi",
} as const;

type TableName = (typeof TABLES)[keyof typeof TABLES];

// ============================================================================
// Sprint B — Enrutado de base por cliente (aislamiento multi-cliente)
// ============================================================================
//
// Modelo (decidido con el fundador):
//   · Dos clientes legales = dos bases FÍSICAS distintas (RB, INDEP).
//   · Identidad (Usuarios) = base CENTRAL, compartida.
//   · `DEMO` = la base actual (AIRTABLE_BASE_ID), solo para demo/dev.
//
// `base(tabla)` accede a DATOS DE NEGOCIO y resuelve la base según el CLIENTE del
// contexto de la petición (AsyncLocalStorage). FAIL-CLOSED: si no hay cliente en
// contexto, LANZA — nunca cae a una base por defecto. Así es imposible leer/escribir
// datos de negocio sin haber declarado explícitamente el cliente.
//
// `baseCentral(tabla)` accede a IDENTIDAD y siempre usa la base central.

export type Cliente = "RB" | "INDEP" | "DEMO";

const clienteContext = new AsyncLocalStorage<Cliente>();

/**
 * Ejecuta `fn` con `cliente` fijado en el contexto de la petición. Todas las
 * llamadas a `base()` dentro de `fn` (y su cadena async) resolverán esa base.
 * Es la ÚNICA forma de habilitar el acceso a datos de negocio.
 */
export function runWithCliente<T>(cliente: Cliente, fn: () => T): T {
  return clienteContext.run(cliente, fn);
}

/** Cliente actual del contexto, o null si no hay ninguno establecido. */
export function currentCliente(): Cliente | null {
  return clienteContext.getStore() ?? null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (Sprint B multi-base)`);
  return v;
}

function baseIdForCliente(cliente: Cliente): string {
  switch (cliente) {
    case "RB":
      return requireEnv("AIRTABLE_BASE_RB");
    case "INDEP":
      return requireEnv("AIRTABLE_BASE_INDEP");
    case "DEMO":
      return requireEnv("AIRTABLE_BASE_ID"); // base actual = demo/dev
  }
}

// Cache de instancias Airtable.Base por baseId (una por base física).
const _bases = new Map<string, Airtable.Base>();

function airtableBase(baseId: string): Airtable.Base {
  let b = _bases.get(baseId);
  if (!b) {
    const apiKey = requireEnv("AIRTABLE_API_KEY");
    Airtable.configure({ apiKey });
    b = Airtable.base(baseId);
    _bases.set(baseId, b);
  }
  return b;
}

/**
 * Acceso a DATOS DE NEGOCIO. Resuelve la base según el cliente del contexto.
 * FAIL-CLOSED: lanza si no hay cliente establecido (nunca base por defecto).
 */
export function base(tableName: TableName) {
  const cliente = clienteContext.getStore();
  if (!cliente) {
    throw new Error(
      `[aislamiento] base("${tableName}") llamado sin cliente en contexto. ` +
        `Envuelve la operación con runWithCliente()/withAuth (Sprint B fail-closed).`,
    );
  }
  return airtableBase(baseIdForCliente(cliente))(tableName);
}

/**
 * Acceso a IDENTIDAD (Usuarios). SIEMPRE la base central, independiente del
 * cliente. Usar SOLO para tablas de identidad; nunca para datos de negocio.
 */
export function baseCentral(tableName: TableName) {
  return airtableBase(requireEnv("AIRTABLE_BASE_CENTRAL"))(tableName);
}

/**
 * fetchAll — paginación completa garantizada via eachPage.
 * Usar en lugar de .all() para asegurar que se traen todos los registros.
 */
export async function fetchAll(query: any): Promise<any[]> {
  const records: any[] = [];
  await new Promise<void>((resolve, reject) => {
    query.eachPage(
      (pageRecords: any[], nextPage: () => void) => { records.push(...pageRecords); nextPage(); },
      (err: Error | null) => (err ? reject(err) : resolve()),
    );
  });
  return records;
}
