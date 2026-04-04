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
