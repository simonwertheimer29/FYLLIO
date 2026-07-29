// app/lib/time.ts
export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * ✅ Parse LOCAL real para "YYYY-MM-DDTHH:mm:ss" (sin timezone)
 * Evita que el runtime lo trate como UTC y haga shifts raros.
 */
export function parseLocal(iso: string) {
  // acepta "YYYY-MM-DDTHH:mm:ss" o "YYYY-MM-DDTHH:mm"
  const [datePart, timePartRaw = "00:00:00"] = iso.split("T");
  const [yyyy, mm, dd] = datePart.split("-").map(Number);

  const timePart = timePartRaw.length === 5 ? `${timePartRaw}:00` : timePartRaw;
  const [hh, mi, ss] = timePart.split(":").map(Number);

  return new Date(yyyy, (mm ?? 1) - 1, dd ?? 1, hh ?? 0, mi ?? 0, ss ?? 0);
}

export function toLocalIso(d: Date) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

export function addMinutesLocal(iso: string, mins: number) {
  const d = parseLocal(iso);
  d.setMinutes(d.getMinutes() + mins);
  return toLocalIso(d);
}

export function minutesBetween(aIso: string, bIso: string) {
  const a = parseLocal(aIso).getTime();
  const b = parseLocal(bIso).getTime();
  return Math.round((b - a) / 60000);
}

export function formatTime(iso: string) {
  const d = parseLocal(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function sortByStart<T extends { start: string }>(items: T[]) {
  return [...items].sort((x, y) => parseLocal(x.start).getTime() - parseLocal(y.start).getTime());
}

// ─── El día de la clínica ───────────────────────────────────────────────
//
// `new Date().toISOString().slice(0,10)` devuelve el día EN UTC. En Madrid, a
// partir de las 22:00 (23:00 en invierno) eso ya es MAÑANA. Lo cazó la pasada
// visual de /leads (2026-07-27, 21:32 local): una cita del 29 se anunciaba
// como "mañana" y un lead citado para hoy se caía de la columna "Citados Hoy".
//
// Y la hora local del proceso tampoco sirve: en Vercel el servidor corre en
// UTC, así que `getDate()` en una ruta de API da el día de Londres. La zona de
// referencia es LA DE LA CLÍNICA, y se declara explícitamente — nunca se
// hereda del runtime.

/** Las clínicas del piloto están en España. Cuando haya clínicas en otra zona,
 *  esto pasa a salir de la ficha de la clínica; hasta entonces, una constante
 *  declarada es infinitamente mejor que el TZ del proceso. */
export const TZ_CLINICA = "Europe/Madrid";

function partesEnZona(d: Date, tz: string): Record<string, string> {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of partes) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

/** El día de calendario de la clínica, "YYYY-MM-DD". */
export function hoyISO(d: Date = new Date(), tz: string = TZ_CLINICA): string {
  const p = partesEnZona(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** El mes de calendario de la clínica, "YYYY-MM". */
export function mesISO(d: Date = new Date(), tz: string = TZ_CLINICA): string {
  return hoyISO(d, tz).slice(0, 7);
}

/** La hora de la clínica, "HH:mm" — comparable con `leads.hora_cita`. */
export function horaClinica(d: Date = new Date(), tz: string = TZ_CLINICA): string {
  const p = partesEnZona(d, tz);
  // Intl con hour12:false devuelve "24" a medianoche en algunos runtimes.
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Suma días a un "YYYY-MM-DD". Aritmética de calendario pura, sin husos. */
export function sumaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El INSTANTE en que empieza ese día en la clínica. Es lo que hay que pasar a
 *  una consulta por timestamp: a las 00:00 de Madrid en julio son las 22:00 UTC
 *  del día anterior, y filtrar por `T00:00:00Z` se comía dos horas de trabajo. */
export function inicioDelDiaUTC(iso: string, tz: string = TZ_CLINICA): Date {
  const aprox = new Date(`${iso}T00:00:00Z`);
  const enUtc = new Date(aprox.toLocaleString("en-US", { timeZone: "UTC" }));
  const enZona = new Date(aprox.toLocaleString("en-US", { timeZone: tz }));
  return new Date(aprox.getTime() - (enZona.getTime() - enUtc.getTime()));
}
