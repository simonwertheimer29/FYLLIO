// app/lib/airtable.ts
import Airtable from "airtable";

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
} as const;

type TableName = (typeof TABLES)[keyof typeof TABLES];

let _base: Airtable.Base | null = null;

export function base(tableName: TableName) {
  if (!_base) {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;

    if (!baseId || !apiKey) {
      throw new Error(
        `Missing Airtable env vars. AIRTABLE_BASE_ID=${!!baseId} AIRTABLE_API_KEY=${!!apiKey}`
      );
    }

    Airtable.configure({ apiKey });
    _base = Airtable.base(baseId);
  }

  return _base(tableName);
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
