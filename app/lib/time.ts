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
