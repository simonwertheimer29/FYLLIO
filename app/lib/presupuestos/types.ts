// app/lib/presupuestos/types.ts

export type PresupuestoEstado =
  | "PRESENTADO"
  | "INTERESADO"
  | "EN_DUDA"
  | "EN_NEGOCIACION"
  | "ACEPTADO"
  | "PERDIDO";

export type TipoPaciente = "Adeslas" | "Privado";
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
};

export type Contacto = {
  id: string;
  presupuestoId: string;
  tipo: TipoContacto;
  resultado: ResultadoContacto;
  fechaHora: string;
  nota?: string;
  registradoPor?: string;
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
  rol: "manager_general" | "encargada_ventas";
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
  porTipoPaciente: { tipo: string; total: number; aceptados: number; tasa: number }[];
  porTipoVisita: { tipo: string; total: number; aceptados: number; tasa: number }[];
  tendenciaMensual: KpiMensual[];
};
