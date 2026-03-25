// app/lib/presupuestos/types.ts
// Tipos del módulo de Seguimiento de Presupuestos

export type PresupuestoEstado =
  | "BOCA_SANA"
  | "FINALIZADO"
  | "EN_TRATAMIENTO"
  | "INTERESADO"
  | "EN_DUDA"
  | "RECHAZADO";

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
  fechaPresupuesto: string;   // YYYY-MM-DD, editable por encargada
  fechaAlta: string;          // YYYY-MM-DD, auto-set al crear, no editable
  daysSince: number;          // días desde fechaPresupuesto
  clinica?: string;
  notes?: string;
  urgencyScore: number;       // 0-100, computado en cliente
  lastContactDate?: string;   // ISO del último contacto
  lastContactDaysAgo?: number;
  contactCount: number;
  createdBy?: string;
};

export type Contacto = {
  id: string;
  presupuestoId: string;
  tipo: TipoContacto;
  resultado: ResultadoContacto;
  fechaHora: string; // ISO
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
  aceptados: number;
  tasaAceptacion: number;
  importeAceptado: number;
  pacientesNuevos: number; // 1ª Visita aceptados
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

export type KpiData = {
  resumen: KpiResumen;
  porEstado: KpiPorEstado[];
  porDoctor: KpiPorDoctor[];
  porTratamiento: KpiPorTratamiento[];
  porTipoPaciente: { tipo: string; count: number }[];
  porTipoVisita: { tipo: string; count: number }[];
};
