// app/lib/agenda/fechas.ts
//
// G2.6 — fechas de la agenda en español (dictado 30-08): «Lun 31 ago» y
// «Lunes, 31 de agosto», nunca «2026-08-31» en pantalla. Entrada: el día de
// clínica YYYY-MM-DD (ya local); se formatea anclado a mediodía UTC para que
// ningún huso lo desplace de día. PURO client-safe — lo testea qa:agenda.

const anclada = (fecha: string) => new Date(`${fecha}T12:00:00Z`);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const FMT_CORTA = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const FMT_LARGA = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const FMT_DIA_MES = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "long" });
const FMT_DIA_MES_CORTO = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" });

/** "2026-08-31" → "Lun 31 ago". */
export function fechaCorta(fecha: string): string {
  return cap(FMT_CORTA.format(anclada(fecha)).replace(",", "").replace(/\.$/, "").replace(". ", " "));
}

/** "2026-08-31" → "Lunes, 31 de agosto". */
export function fechaLarga(fecha: string): string {
  return cap(FMT_LARGA.format(anclada(fecha)));
}

/** "2026-08-31" → "31 de agosto" (para «Semana del …»). */
export function diaMes(fecha: string): string {
  return FMT_DIA_MES.format(anclada(fecha));
}

/** "2026-08-31" → "31 ago" (filas compactas: pendientes, panel). */
export function diaMesCorto(fecha: string): string {
  return FMT_DIA_MES_CORTO.format(anclada(fecha)).replace(/\.$/, "").replace(". ", " ");
}
