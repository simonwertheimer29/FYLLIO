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

// ─── Nivel 2 · la EDAD de una lectura externa ───────────────────────────────
// El dato externo lleva siempre su edad (dictado): «hace 3 min» se entiende;
// un timestamp crudo no. A partir de un día, la fecha corta con hora.

/** ISO → "hace 3 min" · "hace 2 h" · "el Lun 31 ago a las 09:15". */
export function edadLegible(iso: string, ahora: Date = new Date()): string {
  const ms = ahora.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `el ${fechaHoraLegible(iso)}`;
}

/** ISO → "Lun 31 ago a las 09:15" (en la zona de la clínica). */
export function fechaHoraLegible(iso: string): string {
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat("es-ES", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid",
  }).format(d).replace(/\.$/, "").replace(". ", " ").replace(/^(\w)/, (m) => m.toUpperCase());
  const hora = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid",
  }).format(d);
  return `${fecha} a las ${hora}`;
}
