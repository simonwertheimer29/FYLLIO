// app/lib/automatizaciones/types.ts
//
// Sprint 16b Bloque 1 — tipos del motor de automatizaciones.

export type TriggerTipo =
  | "lead_creado"
  | "cita_confirmada_24h_antes"
  | "presupuesto_presentado"
  | "presupuesto_estancado_7d"
  | "lead_inactivo_n_dias";

export type EventoTipo =
  | "lead_creado"
  | "cita_creada"
  | "presupuesto_creado"
  | "presupuesto_actualizado";

export type Operador =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists"
  | "contains";

export type Condicion = {
  campo: string;
  operador: Operador;
  valor?: unknown;
};

export type AccionTipo =
  | "enviar_whatsapp_template"
  | "crear_alerta_coordinadora"
  | "actualizar_estado_lead"
  | "crear_accion_lead";

export type Accion = {
  tipo: AccionTipo;
  params: Record<string, unknown>;
};

export type Regla = {
  id: string;
  clinicaId: string | null; // null = global
  codigo: string;
  nombre: string;
  descripcion: string;
  triggerTipo: TriggerTipo;
  condiciones: Condicion[];
  acciones: Accion[];
  activa: boolean;
  vecesDisparada: number;
  ultimaDisparada: string | null;
  modoTest: boolean;
  pacienteTestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventoSistema = {
  tipo: EventoTipo;
  entidadTipo: "Lead" | "Paciente" | "Presupuesto" | "Cita";
  entidadId: string;
  payload: Record<string, unknown>;
};

export type ResultadoEjecucion =
  | "success"
  | "error"
  | "skipped_cooldown"
  | "skipped_optout"
  | "skipped_horario"
  | "skipped_test"
  | "skipped_dedupe";

export type AccionLog = {
  id: string;
  reglaId: string;
  pacienteId: string | null;
  leadId: string | null;
  presupuestoId: string | null;
  resultado: ResultadoEjecucion;
  detalle: string; // JSON
  ejecutadaAt: string;
};

export type HorarioDia = {
  activo: boolean;
  inicio: string; // "HH:MM"
  fin: string;
};

export type HorarioLaboral = {
  lunes: HorarioDia;
  martes: HorarioDia;
  miercoles: HorarioDia;
  jueves: HorarioDia;
  viernes: HorarioDia;
  sabado: HorarioDia;
  domingo: HorarioDia;
};

export const HORARIO_DEFAULT: HorarioLaboral = {
  lunes: { activo: true, inicio: "09:00", fin: "20:00" },
  martes: { activo: true, inicio: "09:00", fin: "20:00" },
  miercoles: { activo: true, inicio: "09:00", fin: "20:00" },
  jueves: { activo: true, inicio: "09:00", fin: "20:00" },
  viernes: { activo: true, inicio: "09:00", fin: "20:00" },
  sabado: { activo: false, inicio: "10:00", fin: "14:00" },
  domingo: { activo: false, inicio: "10:00", fin: "14:00" },
};
