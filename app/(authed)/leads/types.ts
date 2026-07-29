// Tipos compartidos entre LeadsView y sus modales. Se extrae a este
// archivo para romper el ciclo de imports (LeadsView → Modal → LeadsView)
// que estaba haciendo a Turbopack HMR entrar en estado inconsistente
// tras ediciones rápidas ("missing required error components…").

export type LeadEstado =
  | "Nuevo"
  | "Contactado"
  | "Citado"
  | "Citados Hoy"
  | "No Interesado"
  | "Convertido";

export type Lead = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamiento: string | null;
  canal: string | null;
  estado: LeadEstado;
  clinicaId: string | null;
  clinicaNombre?: string | null;
  fechaCita: string | null;
  horaCita: string | null;
  doctorAsignadoId: string | null;
  tipoVisita: "Primera visita" | "Revisión" | "Urgencia" | null;
  motivoNoInteres: import("../../lib/leads/motivos").MotivoLeadAlmacenado | null;
  /** Cuándo se cerró (Convertido / No Interesado). Null = cerrado antes de
   *  que el dato existiera, o todavía abierto. */
  fechaCierre: string | null;
  /** Sprint 10 B — clasificación IA cacheada. */
  intencionDetectada:
    | "Interesado"
    | "Pide más info"
    | "Pregunta precio"
    | "Pide cita"
    | "No interesado"
    | "Sin clasificar"
    | null;
  mensajeSugerido: string | null;
  accionSugerida: string | null;
  llamado: boolean;
  whatsappEnviados: number;
  ultimaAccion: string | null;
  notas: string | null;
  convertido: boolean;
  pacienteId: string | null;
  asistido: boolean;
  createdAt: string;
  /** Estado de la conversación según el MOTOR compartido (el de /seguimiento y
   *  /red), calculado en el servidor. La card lo usa para decir algo cierto
   *  sobre el tiempo: "sin respuesta hace 3 días" no se puede medir desde la
   *  captación. Opcional porque los modales construyen Leads parciales. */
  conversacion?: import("../../lib/presupuestos/estado-conversacion").EstadoConversacion;
  /** Último mensaje/acción ENTRANTE y SALIENTE (ISO), de las mismas fuentes. */
  entranteAt?: string | null;
  salienteAt?: string | null;
};
