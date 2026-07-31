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

// ─── Escribir una fecha en pantalla ─────────────────────────────────────
//
// LA ÚLTIMA FAMILIA DE MEJORAS 52, cerrada el 2026-08-01. Las funciones de
// arriba arreglaron el día que el producto CALCULA; estas arreglan el que
// ESCRIBE, que iba por libre: `toLocaleString("es-ES", …)` sin `timeZone` pinta
// en la zona del NAVEGADOR (o, en una ruta de servidor, en la de Vercel = UTC).
//
// No era teórico. En /llamadas las doce llamadas están registradas a las 07:00Z,
// que son las 09:00 de Madrid — hora de clínica perfecta. Lo que se veía:
//     Madrid 09:00 · UTC 07:00 · New_York 03:00 · Chicago 02:00
// La revisión externa reportó "todas las fechas marcan 02:00" porque su
// navegador estaba en horario central de EE. UU. El dato era correcto; la misma
// pantalla le enseñaba una hora distinta a cada persona. Y en el portátil desde
// el que se hacen las demos (UTC−4/−5) pasa exactamente igual.
//
// **Dos funciones y no una, a propósito**, porque hay DOS cosas distintas:
//   · un INSTANTE (`timestamptz`: cuándo ocurrió algo) → se convierte a la zona
//     de la clínica;
//   · un DÍA DE CALENDARIO (`date`, "2026-07-29": la fecha de una cita) → NO se
//     convierte, porque no tiene hora que convertir. Pasarlo por un huso es
//     precisamente cómo se pierde un día.
// El código venía resolviendo lo segundo con `new Date(dia + "T12:00:00")`: un
// truco correcto pero mudo, que el siguiente en pasar "limpia" y rompe.
// `fechaClinica` reconoce los dos formatos y hace lo que toca con cada uno.

const ES_DIA_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

export type OpcionesFecha = {
  /** "lun 31 jul" en vez de "31 jul". */
  diaSemana?: boolean;
  /** "31 jul 2026". */
  anio?: boolean;
  /** "31 de julio" en vez de "31 jul". */
  mesLargo?: boolean;
};

function opcionesIntl(o: OpcionesFecha = {}): Intl.DateTimeFormatOptions {
  return {
    ...(o.diaSemana ? { weekday: o.mesLargo ? ("long" as const) : ("short" as const) } : {}),
    day: "numeric",
    month: o.mesLargo ? "long" : "short",
    ...(o.anio ? { year: "numeric" as const } : {}),
  };
}

/** Convierte lo que llegue a un Date, o null si no es una fecha. */
function aDate(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  // Un día de calendario se ancla a MEDIODÍA UTC y se formatea en UTC: así el
  // día impreso es el que dice la cadena, en cualquier huso del planeta.
  const d =
    typeof valor === "string" && ES_DIA_CALENDARIO.test(valor)
      ? new Date(`${valor}T12:00:00Z`)
      : valor instanceof Date
        ? valor
        : new Date(valor);
  return Number.isFinite(d.getTime()) ? d : null;
}

const esDia = (valor: string | Date | null | undefined) =>
  typeof valor === "string" && ES_DIA_CALENDARIO.test(valor);

/**
 * La fecha, en el día de la clínica. Acepta un instante ISO/Date o un día de
 * calendario "YYYY-MM-DD" y hace lo correcto con cada uno.
 * → "31 jul" · "lun 31 jul" · "31 de julio de 2026"
 * Devuelve `vacio` (por defecto "—") si no hay fecha o no se puede leer: casi
 * todos los sitios que sustituye ya hacían ese guardia a mano.
 */
export function fechaClinica(
  valor: string | Date | null | undefined,
  opciones: OpcionesFecha = {},
  vacio = "—",
): string {
  const d = aDate(valor);
  if (!d) return vacio;
  return d
    .toLocaleDateString("es-ES", {
      ...opcionesIntl(opciones),
      timeZone: esDia(valor) ? "UTC" : TZ_CLINICA,
    })
    // es-ES mete una coma tras el día de la semana ("mié, 29 jul"), que detrás
    // de "Cita" se lee como una pausa rara.
    .replace(/^(\p{L}+),/u, "$1");
}

/**
 * La fecha Y LA HORA de un INSTANTE, en la zona de la clínica.
 * → "31 jul, 09:00"
 * No acepta días de calendario: un `date` no tiene hora, y fingir una es
 * inventar un dato. Si llega uno, se devuelve solo la fecha.
 */
export function fechaHoraClinica(
  valor: string | Date | null | undefined,
  opciones: OpcionesFecha = {},
  vacio = "—",
): string {
  if (esDia(valor)) return fechaClinica(valor, opciones, vacio);
  const d = aDate(valor);
  if (!d) return vacio;
  return d.toLocaleString("es-ES", {
    ...opcionesIntl(opciones),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ_CLINICA,
  });
}
