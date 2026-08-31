// NIVEL 2 — EL CONTRATO DEL CONECTOR DE AGENDA (dictado 31-08).
//
// Genérico a propósito: Google Calendar es el PRIMERO, no el destinatario.
// Por eso paciente/tratamiento/sillón existen como OPCIONALES aunque Calendar
// nunca los llene — un PMS (Gesden y compañía) sí lo hará, y diseñar el
// contrato solo para Google sería ajustarlo al sistema más pobre (dictado).
//
// El conector es TONTO: lee y traduce. Persistir, fusionar con el motor y
// decidir qué se enseña es de lib/agenda/agenda-externa — así el conector
// nuevo del PMS se escribe sin tocar nada más.

export type OcupacionLeida = {
  /** Id del evento en el sistema externo — la clave del upsert (§2). */
  externalId: string;
  inicio: Date;
  fin: Date;
  /** Título del evento, texto plano. null = privado o sin título. */
  etiqueta: string | null;
  diaEntero: boolean;
  // ── Opcionales del contrato: el PMS los llena, Calendar no. ──
  pacienteTexto?: string | null;
  tratamientoTexto?: string | null;
  sillonTexto?: string | null;
};

export type ResultadoPull =
  | {
      ok: true;
      /** Lo vigente leído (los «disponible»/transparentes NO vienen: no ocupan). */
      ocupaciones: OcupacionLeida[];
      /** externalIds que el sistema externo dice que ya no ocupan (borrados,
       *  cancelados o vueltos transparentes) — solo en pulls incrementales. */
      borrados: string[];
      /** Cursor para el siguiente pull incremental. null = la fuente no da. */
      cursor: string | null;
      /** true = pull COMPLETO de la ventana: lo no presente se purga. */
      completo: boolean;
    }
  | {
      ok: false;
      /** Para el log y la pantalla — qué pasó, legible. */
      motivo: string;
      /** El cursor caducó (Google: 410): reintentar con pull completo. */
      reintentarConPullCompleto?: boolean;
    };

export interface ConectorAgenda {
  fuente: "google_calendar";
  pull(p: {
    /** Qué agenda en el sistema externo (Calendar: calendarId). */
    referenciaExterna: string;
    /** Ventana del pull completo; los incrementales la ignoran. */
    desde: Date;
    hasta: Date;
    /** Cursor del pull anterior. null = pull completo. */
    cursor: string | null;
  }): Promise<ResultadoPull>;
}
