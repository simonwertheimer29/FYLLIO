// app/lib/presupuestos/types.ts

export type PresupuestoEstado =
  | "PRESENTADO"
  | "INTERESADO"
  | "EN_DUDA"
  | "EN_NEGOCIACION"
  | "ACEPTADO"
  | "PERDIDO";

export type TipoPaciente = "Adeslas" | "Privado";
export type OrigenLead = "google_ads" | "seo_organico" | "referido_paciente" | "redes_sociales" | "walk_in" | "otro";
export type MotivoPerdida = "precio_alto" | "otra_clinica" | "sin_urgencia" | "necesita_financiacion" | "miedo_tratamiento" | "no_responde" | "otro";
export type MotivoDuda = "precio" | "otra_clinica" | "sin_urgencia" | "financiacion" | "miedo" | "comparando_opciones" | "otro";
export type TonoIA = "directo" | "empatico" | "urgencia";
export type TipoVisita = "Primera Visita" | "Paciente con Historia";
export type EspecialidadDoctor =
  | "General"
  | "Prostodoncista"
  | "Implantólogo"
  | "Endodoncista"
  | "Ortodoncia";
export type TipoContacto = "llamada" | "whatsapp" | "email" | "visita";
export type ResultadoContacto =
  | "contestó"
  | "no contestó"
  | "acordó cita"
  | "rechazó"
  | "pidió tiempo";

export type Presupuesto = {
  id: string;
  patientName: string;
  patientPhone?: string;
  treatments: string[];
  doctor?: string;
  doctorEspecialidad?: EspecialidadDoctor;
  tipoPaciente?: TipoPaciente;
  tipoVisita?: TipoVisita;
  amount?: number;
  estado: PresupuestoEstado;
  fechaPresupuesto: string;   // YYYY-MM-DD
  fechaAlta: string;          // YYYY-MM-DD, auto-set
  daysSince: number;
  clinica?: string;
  notes?: string;
  urgencyScore: number;
  lastContactDate?: string;
  lastContactDaysAgo?: number;
  contactCount: number;
  createdBy?: string;
  numeroHistoria?: string;
  origenLead?: OrigenLead;
  motivoPerdida?: MotivoPerdida;
  motivoPerdidaTexto?: string;
  motivoDuda?: MotivoDuda;
  reactivacion?: boolean;  // marcado para reactivar en 90 días tras perderse
};

export type Contacto = {
  id: string;
  presupuestoId: string;
  tipo: TipoContacto;
  resultado: ResultadoContacto;
  fechaHora: string;
  nota?: string;
  registradoPor?: string;
  mensajeIAUsado?: boolean;
  tonoUsado?: TonoIA;
};

export type Doctor = {
  id: string;
  nombre: string;
  especialidad: EspecialidadDoctor;
  clinica?: string;
  activo: boolean;
};

export type UserSession = {
  email: string;
  nombre: string;
  rol: "manager_general" | "encargada_ventas" | "admin";
  clinica: string | null;
};

// KPI types
export type KpiResumen = {
  total: number;
  primeraVisita: number;
  conHistoria: number;
  aceptados: number;
  tasaAceptacion: number;
  importeActivos: number;
};

export type KpiPorEstado = { estado: PresupuestoEstado; count: number; importe: number };

export type KpiPorDoctor = {
  doctor: string;
  especialidad: string;
  total: number;
  primeraVisita: number;
  conHistoria: number;
  aceptados: number;
  tasa: number;
};

export type KpiPorTratamiento = {
  grupo: string;
  total: number;
  aceptados: number;
  tasa: number;
  importe: number;
};

export type KpiMensual = {
  mes: string;   // "YYYY-MM"
  label: string; // "Ene", "Feb", ...
  total: number;
  aceptados: number;
};

export type KpiComparacion = {
  actual: number;
  anterior: number;
  diff: number;
  diffPct: number;
};

export type KpiTendenciaTarifa = {
  mes: string; label: string;
  privado: number; privadoAcept: number;
  adeslas: number; adeslasAcept: number;
};

export type KpiTendenciaVisita = {
  mes: string; label: string;
  primera: number; primeraAcept: number;
  historia: number; historiaAcept: number;
};

export type KpiPorOrigen = {
  origen: string;
  label: string;
  total: number;
  aceptados: number;
  tasa: number;
  importe: number;
};

export type KpiPorMotivoPerdida = {
  motivo: string;
  label: string;
  count: number;
  pct: number;
};

export type KpiPorClinica = {
  clinica: string;
  total: number;
  aceptados: number;
  tasa: number;
  importe: number;
};

export type KpiData = {
  resumen: KpiResumen;
  comparacion: {
    mesActual: KpiComparacion;
    trimestre: KpiComparacion;
    anio: KpiComparacion;
  };
  porEstado: KpiPorEstado[];
  porDoctor: KpiPorDoctor[];
  porTratamiento: KpiPorTratamiento[];
  porTipoPaciente: { tipo: string; total: number; aceptados: number; tasa: number; importe: number }[];
  porTipoVisita: { tipo: string; total: number; aceptados: number; tasa: number; importe: number }[];
  tendenciaMensual: KpiMensual[];
  tendenciaPorTarifa: KpiTendenciaTarifa[];
  tendenciaPorVisita: KpiTendenciaVisita[];
  doctores: string[];
  porOrigenLead: KpiPorOrigen[];
  porMotivoPerdida: KpiPorMotivoPerdida[];
  porClinica: KpiPorClinica[];
};
