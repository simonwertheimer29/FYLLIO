// app/lib/no-shows/types.ts
// Tipos para el módulo standalone de no-shows

export type NoShowsUserSession = {
  email: string;
  nombre: string;
  rol: "manager_general" | "encargada_ventas" | "ventas";
  clinica: string | null;   // null = todas las clínicas (solo manager)
  staffId?: string | null;  // ID del profesional para vistas personales
};

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

export type RiskFactors = {
  historicalNoShowRate: number;      // 0–1 tasa real
  historicalNoShowCount: number;
  historicalCancelCount: number;
  historicalTotalAppts: number;
  daysSinceBooked: number;
  dayOfWeek: number;                 // 1=Lun … 7=Dom
  hourOfDay: number;                 // 0–23
  treatmentRisk: RiskLevel;
  dayTimeLabel: string;
};

export type RiskyAppt = {
  id: string;                        // Airtable record ID
  patientName: string;
  patientPhone: string;
  start: string;                     // ISO datetime
  end: string;                       // ISO datetime
  startDisplay: string;              // "HH:mm"
  treatmentName: string;
  doctor?: string;                   // Profesional_id asignado (opcional)
  doctorNombre?: string;             // "Dr. Andrés Rojas" (resuelto)
  clinica?: string;
  clinicaNombre?: string;            // "Clínica Demo FYLLIO" (resuelto)
  sillonNombre?: string;             // "Sillón 1" (resuelto)
  profesionalId?: string;            // STF_001, STF_002, STF_003
  dayIso: string;                    // "YYYY-MM-DD"
  riskScore: number;                 // 0–100
  scoreAccion?: number;              // riskScore*0.6 + urgenciaTemporal*0.4
  riskLevel: RiskLevel;
  actionDeadline?: string;           // ISO datetime
  actionUrgent?: boolean;
  confirmed: boolean;
  riskFactors: RiskFactors;
  // Confianza e historial (calculados en /api/no-shows/acciones)
  histTotal?: number;                // Total citas pasadas del paciente
  histCompletados?: number;          // Citas completadas (asistió)
  histNoShows?: number;              // No-shows
  histCancels?: number;              // Cancelaciones (sin [NO_SHOW])
  confianza?: number;                // 0–1: histCompletados / histTotal
  ultimasCitas?: Array<{
    fecha: string;                   // "YYYY-MM-DD"
    tratamiento: string;
    resultado: "completado" | "cancelado" | "no_show";
  }>;
  ultimaAccion?: string;             // Fecha ISO del último contacto registrado (Airtable)
  tipoUltimaAccion?: string;         // "WA enviado" | "Llamada" | "Sin respuesta" | etc.
};

/** Paciente a mitad de tratamiento sin próxima cita agendada */
export type RecallAlert = {
  patientName: string;
  patientPhone: string;
  treatmentName: string;
  clinica?: string;
  lastApptIso: string;               // Fecha última cita
  weeksSinceLast: number;
  treatmentDurationMonths?: number;  // Duración esperada del tratamiento
};

export type GapSlot = {
  dayIso: string;
  startIso: string;
  endIso: string;
  startDisplay: string;              // "HH:mm"
  endDisplay: string;
  durationMin: number;
  staffId?: string;
  clinica?: string;
};

export type AccionTask = {
  id: string;
  category: "NO_SHOW" | "GAP";
  patientName?: string;
  phone?: string;
  description: string;
  whatsappMsg?: string;
  deadlineIso?: string;              // ISO datetime
  urgent: boolean;
  appt?: RiskyAppt;
  gap?: GapSlot;
  // Scoring combinado (riesgo + urgencia temporal)
  scoreAccion?: number;              // 0–100: riskScore*0.6 + urgencia*0.4
  urgencia?: number;                 // urgenciaTemporal raw (0–100)
  hoursUntil?: number;               // horas hasta la cita (negativo = ya pasó)
  overbooking?: boolean;             // gap con hueco reschedulable detectado
  // Estado de gestión (source of truth = Airtable)
  yaGestionado?: boolean;            // true si Tipo_ultima_accion="Confirmado"/"Cancelado" O Estado confirmado/cancelado
};

/** Resumen del header HOY */
export type HoyResumen = {
  totalCitas: number;
  confirmadas: number;
  riesgoAlto: number;
  riesgoMedio: number;
  recalls: number;
};

/** Tendencia semanal (para KPIs) */
export type WeeklyTrend = { week: string; tasa: number };

/** Datos de ingresos recuperados por Fyllio */
export type IngresosRecuperados = {
  tasaPreFyllio: number;             // Configurable en CONFIG
  baselineProjection: number;        // €: actividad real × tasa pre-Fyllio
  ingresosReales: number;            // € ingresos del mes
  delta: number;                     // ingresosReales - baselineProjection
  mesAnteriorIngresos: number;       // Para comparar tendencia
  monthlyData: { month: string; real: number; baseline: number }[];  // 12 meses
};

/** Datos de KPIs */
export type NoShowKpiData = {
  tasa: number;                     // 0–1 tasa de no-show
  totalCitas: number;
  totalNoShows: number;
  tasaSector: number;               // 0.12 media sector
  byDayOfWeek: { day: string; tasa: number }[];
  byTreatment: { treatment: string; tasa: number }[];
  byProfesional?: { nombre: string; tasa: number }[];
  byClinica?: { clinica: string; tasa: number }[];
  weeklyTrend: WeeklyTrend[];       // Últimas 8 semanas
  ingresosRecuperados?: IngresosRecuperados;
};

/** Informe semanal de no-shows guardado en Airtable */
export type InformeNoShow = {
  id: string;
  tipo: "noshow_semanal";
  clinica: string;
  periodo: string;                   // "2026-W15"
  titulo: string;
  contenidoJson: {
    totalCitas: number;
    totalNoShows: number;
    tasa: number;
    porClinica?: { clinica: string; tasa: number }[];
    alertas?: string[];
  };
  textoNarrativo?: string;
  generadoEn: string;                // ISO
  generadoPor: string;
};

/** Configuración por clínica */
export type NoShowsConfig = {
  clinica: string | null;            // null = global
  riskHighThreshold: number;         // default 60
  riskMediumThreshold: number;       // default 30
  highRiskTreatments: string[];
  lowRiskTreatments: string[];
  whatsappTemplates: {
    high: string;
    medium: string;
    low: string;
  };
  reminderRules: {
    send48h: boolean;
    send24h: boolean;
    send72h: boolean;                // Solo HIGH
    sendHour: number;                // 0–23
  };
  tasaPreFyllio: number;             // Para cálculo ROI en KPIs
};

/** Respuesta de /api/no-shows/riesgo */
export type RiskData = {
  clinica?: string;
  week: string;
  appointments: RiskyAppt[];
  recalls: RecallAlert[];
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalAppointments: number;
    recallCount: number;
  };
  isDemo?: boolean;
};
