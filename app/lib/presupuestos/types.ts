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

export type TipoAccion =
  | "cambio_estado"
  | "contacto"
  | "portal_generado"
  | "portal_visto"
  | "portal_aceptado"
  | "portal_rechazado"
  | "mensaje_automatico";

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
  portalEnviado?: boolean; // portal de presupuesto enviado al paciente
  ofertaActiva?: boolean;  // se ha realizado una oferta activa al paciente
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
  oferta?: boolean;
};

export type HistorialAccion = {
  id: string;
  presupuestoId: string;
  tipo: TipoAccion;
  descripcion: string;
  metadata?: Record<string, unknown>;
  registradoPor?: string;
  clinica?: string;
  fecha: string;
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
  rol: "manager_general" | "encargada_ventas" | "admin" | "ventas";
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
  techoPrecio?: number | null; // detected price ceiling (€)
  techoInfo?: {
    tasaBelow: number;
    tasaAbove: number;
    confianza: "alta" | "media" | "baja";
    sampleBelow: number;
    sampleAbove: number;
  } | null;
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

// ─── Informes guardados ───────────────────────────────────────────────────────

export type InformeGuardado = {
  id: string;
  tipo: "semanal" | "mensual";
  clinica: string;
  periodo: string;        // "YYYY-MM" for monthly, "YYYY-WNN" for weekly
  titulo: string;
  contenidoJson?: string; // JSON string with metrics
  textoNarrativo?: string;
  generadoEn: string;
  generadoPor: string;
};

// ─── Automatizaciones ─────────────────────────────────────────────────────────

export type TipoEvento =
  | "presupuesto_inactivo"
  | "portal_visto_sin_respuesta"
  | "reactivacion_programada"
  | "presupuesto_aceptado_notificacion";

export type SecuenciaEstado = "pendiente" | "enviado" | "descartado";

export interface Secuencia {
  id: string;
  presupuestoId: string;
  clinica: string;
  pacienteNombre: string;
  telefono: string;
  tratamiento: string;
  tipoEvento: TipoEvento;
  estado: SecuenciaEstado;
  mensajeGenerado: string;
  tonoUsado: string;
  canalSugerido: "whatsapp" | "email" | "interno";
  creadoEn: string;
  actualizadoEn: string;
}

export interface ConfiguracionAutomatizacion {
  clinica: string;
  activa: boolean;
  diasInactividadAlerta: number;
  diasPortalSinRespuesta: number;
  diasReactivacion: number;
  modoWhatsapp?: ModoWhatsApp;
}

// ─── Mensajería WhatsApp ─────────────────────────────────────────────────────

export type FuenteMensaje = "Modo_A_manual" | "Modo_B_WABA" | "Plantilla_automatica" | "Respuesta_IA";
export type DireccionMensaje = "Entrante" | "Saliente";
export type ModoWhatsApp = "manual" | "waba";

export type MensajeWhatsApp = {
  id: string;
  pacienteId?: string;
  presupuestoId?: string;
  /** Sprint 9 fix unificación: presente cuando el mensaje pertenece a un
   *  lead activo (no convertido). Mutuamente exclusivo con presupuestoId
   *  por la lógica del webhook (presupuesto gana si ambos matchean). */
  leadId?: string;
  telefono: string;
  direccion: DireccionMensaje;
  contenido: string;
  timestamp: string;
  fuente: FuenteMensaje;
  procesadoPorIA: boolean;
  intencionDetectada?: IntencionDetectada;
  wabaMessageId?: string;
  notas?: string;
};

// ─── Cola de Intervención ─────────────────────────────────────────────────────

export type IntencionDetectada =
  | "Acepta sin condiciones"
  | "Acepta pero pregunta pago"
  | "Tiene duda sobre tratamiento"
  | "Pide oferta/descuento"
  | "Quiere pensarlo"
  | "Rechaza"
  | "Sin clasificar";

export type UrgenciaIntervencion = "CRÍTICO" | "ALTO" | "MEDIO" | "BAJO" | "NINGUNO";

export type FaseSeguimiento =
  | "Inicial"
  | "Recordatorio 3d"
  | "Recordatorio 7d"
  | "Recordatorio 10d"
  | "Esperando respuesta"
  | "En intervención"
  | "Cerrado";

export type TipoUltimaAccionIntervencion =
  | "WhatsApp enviado"
  | "Llamada realizada"
  | "Mensaje recibido"
  | "Sin respuesta tras llamada";

// Pestañas secundarias de la cola
export type IntervencionTab =
  | "actuar"
  | "cerrados"
  | "todas"
  | "pago"
  | "dudas"
  | "oferta"
  | "pensarlo"
  | "sin_respuesta";

// Urgencia bidireccional (3 ejes)
export type UrgenciaBidireccional = {
  scoreFinal: number;         // 0-100, composite
  scoreIntencion: number;     // 0-40, por intención del paciente
  scoreRespClinica: number;   // 0-30, por tiempo sin respuesta de la clínica
  scoreCierre: number;        // 0-30, por oportunidad de cierre (importe+estado)
};

export type PresupuestoIntervencion = Presupuesto & {
  ultimaRespuestaPaciente?: string;
  fechaUltimaRespuesta?: string;
  intencionDetectada?: IntencionDetectada;
  urgenciaIntervencion?: UrgenciaIntervencion;
  accionSugerida?: string;
  mensajeSugerido?: string;
  faseSeguimiento?: FaseSeguimiento;
  ultimaAccionRegistrada?: string;
  tipoUltimaAccion?: TipoUltimaAccionIntervencion;
  diasDesdeUltimoContacto?: number;
  urgenciaBidireccional?: UrgenciaBidireccional;
};

export type SeccionIntervencion = {
  id: string;
  titulo: string;
  color: string;
  icono: string;
  hexAccent: string;
  items: PresupuestoIntervencion[];
};

export type IntervencionResponse = {
  secciones: SeccionIntervencion[];
  allItems: PresupuestoIntervencion[];
  totalPendientes: number;
  completadasHoy: number;
  casosCompletados: PresupuestoIntervencion[];
  clinicas: string[];
  doctores: string[];
  tratamientos: string[];
  isDemo?: boolean;
};

export type ClasificacionIA = {
  intencion: IntencionDetectada;
  urgencia: UrgenciaIntervencion;
  accionSugerida: string;
  mensajeSugerido: string;
};

// ─── Vista Máxima ────────────────────────────────────────────────────────────

export type EstadoVisual =
  | "Inicial"
  | "Primer contacto"
  | "Segundo contacto"
  | "Necesita intervención"
  | "Acepta sin pagar"
  | "Con cita sin pagar"
  | "Tratamiento iniciado"
  | "Cerrado ganado"
  | "Cerrado perdido";

export type PresupuestoMaxima = PresupuestoIntervencion & {
  estadoVisual: EstadoVisual;
  ultimaAccionTexto?: string;    // "WA enviado hace 3d"
  proximaAccionTexto?: string;   // "Recordatorio en 2d"
};

export type MaximaResponse = {
  presupuestos: PresupuestoMaxima[];
  totales: {
    total: number;
    importeTotal: number;
    porEstadoVisual: Record<string, number>;
  };
  doctoresUnicos: string[];
  tratamientosUnicos: string[];
  clinicasUnicas: string[];
};

// ─── Plantillas y Cola de Envíos ──────────────────────────────────────────────

export type TipoPlantilla = "Primer contacto" | "Recordatorio" | "Detalles de pago" | "Reactivacion";

export type PlantillaMensaje = {
  id: string;
  nombre: string;
  tipo: TipoPlantilla;
  clinica: string;       // "Todas" o nombre clínica
  doctor: string;        // "" = todos
  tratamiento: string;   // "" = todos
  contenido: string;     // con {nombre}, {tratamiento}, etc.
  activa: boolean;
  fechaCreacion: string;
};

export type ConfigRecordatorios = {
  id?: string;
  clinica: string;
  secuenciaDias: number[];  // [3, 7, 10]
  recordatorioMax: number;
  horaEnvio: string;        // "09:00"
  diasRechazoAuto: number;
  activa: boolean;
};

export type TipoEnvio =
  | "Primer contacto"
  | "Recordatorio 1"
  | "Recordatorio 2"
  | "Recordatorio 3"
  | "Detalles de pago"
  | "Reactivacion";

export type EstadoEnvio = "Pendiente" | "Enviado" | "Fallido" | "Cancelado";

export type EnvioItem = {
  id: string;
  presupuestoId: string;
  paciente: string;
  telefono: string;
  contenido: string;
  tipo: TipoEnvio;
  estado: EstadoEnvio;
  programadoPara: string;
  enviadoEn?: string;
  plantillaUsada: string;
  // Campos extra para UI (no en Airtable)
  tratamiento?: string;
  importe?: number;
  doctor?: string;
};

// ─── Notificaciones in-app ───────────────────────────────────────────────────

export type TipoNotificacion =
  | "Intervencion_urgente"
  | "Nuevo_mensaje_paciente"
  | "Presupuesto_aceptado"
  | "Recordatorio_envio"
  | "Sistema";

export type Notificacion = {
  id: string;
  usuario: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link: string;
  leida: boolean;
  fechaCreacion: string;
};

// ─── WABA operational config (telemetría + flag por clínica) ─────────────────

export type ConfigWABA = {
  id?: string;
  clinica: string;
  activo: boolean;
  webhookUrl?: string;
  ultimoMensajeEnviado?: string;
  ultimoMensajeRecibido?: string;
  notas?: string;
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
