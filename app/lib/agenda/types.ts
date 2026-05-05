// app/lib/agenda/types.ts
//
// Sprint 16a Bloque 5 — interfaz foundational del sistema de agenda.
//
// Este módulo NO se implementa todavía. Define los tipos y la interfaz
// que cualquier adapter (fyllio_native / gesden_synced / external_manual /
// hybrid) deberá cumplir cuando, en Sprint 19+ y según resultado de la
// validación R2b con Gesden, se decida la estrategia.
//
// Arquitectura completa documentada en docs/agenda-architecture.md.

export type CitaEstado =
  | "Pendiente"
  | "Confirmada"
  | "Asistida"
  | "No_Asistio"
  | "Cancelada";

export type OrigenSistema =
  | "fyllio_native"
  | "gesden_synced"
  | "external_manual"
  | "sin_definir";

export type SyncStatus = "pending" | "synced" | "error" | "not_applicable";

export type Cita = {
  id: string;
  pacienteId: string;
  doctorId: string;
  clinicaId: string;
  fechaHoraInicio: string; // ISO
  duracionMin: number;
  tratamiento: string;
  estado: CitaEstado;
  origenSistema: OrigenSistema;
  externalId: string | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  notas: string | null;
  createdAt: string;
};

export type Slot = {
  inicio: string; // ISO
  fin: string;
  doctorId: string;
  clinicaId: string;
  /** Sillón si aplica (solo escenarios donde la clínica tracksilla). */
  sillonId?: string | null;
};

export type ListarSlotsArgs = {
  clinicaId: string;
  fechaInicio: Date;
  fechaFin: Date;
  doctorId?: string;
  /** Duración mínima requerida del slot. Default 30. */
  duracionMin?: number;
};

export type CrearCitaArgs = {
  pacienteId: string;
  doctorId: string;
  clinicaId: string;
  fechaHoraInicio: Date;
  duracionMin?: number;
  tratamiento: string;
  notas?: string;
};

/**
 * Interfaz que cualquier adapter de agenda debe implementar.
 * Sprint 16a NO incluye implementación. Las decisiones sobre cuál(es)
 * adapter(s) construir y en qué sprint viven en
 * docs/agenda-architecture.md.
 */
export interface SistemaAgenda {
  /** Devuelve los huecos libres en la ventana solicitada. */
  listarSlotsDisponibles(args: ListarSlotsArgs): Promise<Slot[]>;

  /** Crea una cita y devuelve el record persistido. */
  crearCita(args: CrearCitaArgs): Promise<Cita>;

  /** Cancela (no destruye) una cita; pasa Estado a "Cancelada". */
  cancelarCita(citaId: string): Promise<void>;

  /** Lookup directo. Null si no existe o si el adapter no tiene
   *  visibilidad sobre la cita (p.ej. Gesden-only sin sync). */
  obtenerCita(citaId: string): Promise<Cita | null>;
}
