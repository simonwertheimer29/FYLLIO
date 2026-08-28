// app/lib/agenda/disponibilidad.ts
//
// AGENDA G1c — el cálculo de disponibilidad, escrito de cero (dictado 27-08:
// el motor del MVP respondía a otra pregunta — «dame el primer hueco para
// reagendar» — y sus tres entradas eran inventadas; se tiró entero en G1b).
//
// La pregunta que responde ESTE módulo, por doctor y día:
//
//   franjas del doctor ese día (horarios_staff: día de semana, jornada partida)
//   − bloqueos (ausencias, vacaciones)
//   − sus citas
//   = huecos libres → troceados por la duración del tratamiento
//
// La vista por especialidad es la UNIÓN de los huecos de sus doctores, cada
// hueco etiquetado con el suyo («el martes a las 16:00 con la Dra. Ruiz»,
// nunca una hora anónima) — eso es un map del caller, no una función de aquí.
//
// MÓDULO PURO (sin DB, sin reloj propio, client-safe): todo opera en MINUTOS
// del día local de la clínica, y la única conversión de instante→minutos
// locales se apoya en lib/time (TZ_CLINICA, la misma que el resto del
// producto — mandamiento 13/14: el instante se inyecta, la zona se declara).
//
// Sin defaults del sector (dictado): la duración NO tiene fallback. Si el
// tratamiento no tiene duración configurada, aquí no se llega — el caller lo
// dice y no calcula (§4: un 25 min inventado es un hueco que miente).

import { hoyISO, horaClinica, TZ_CLINICA } from "../time";

/** Intervalo en minutos del día local [inicio, fin). fin > inicio siempre. */
export type IntervaloMin = { inicio: number; fin: number };

/** Franja de horarios_staff tal como se guarda: "HH:MM" locales. */
export type FranjaDia = { inicio: string; fin: string };

/** Un hueco libre u ofertable, etiquetado con su doctor. */
export type HuecoDeDoctor = IntervaloMin & { staffId: string };

// ─── "HH:MM" ⇄ minutos ──────────────────────────────────────────────────────

const RE_HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** "16:30" → 990. Lanza ante formato ilegible: una franja rota en la base es
 *  un dato corrupto, no un cero (§4 — el CHECK de horarios_staff lo impide,
 *  pero este módulo no confía en quién le llama). */
export function aMin(hhmm: string): number {
  const m = RE_HHMM.exec(hhmm);
  if (!m) throw new Error(`franja ilegible: "${hhmm}" no es HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 990 → "16:30". */
export function deMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── Normalizar y restar intervalos ─────────────────────────────────────────

/** Ordena, descarta vacíos/invertidos y FUSIONA solapes y contigüos.
 *  Dos franjas mal metidas (16:00–18:00 y 17:00–20:00) son una: 16:00–20:00. */
export function normalizar(intervalos: ReadonlyArray<IntervaloMin>): IntervaloMin[] {
  const validos = intervalos
    .filter((i) => Number.isFinite(i.inicio) && Number.isFinite(i.fin) && i.fin > i.inicio)
    .map((i) => ({ inicio: i.inicio, fin: i.fin }))
    .sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  const out: IntervaloMin[] = [];
  for (const i of validos) {
    const ult = out[out.length - 1];
    if (ult && i.inicio <= ult.fin) ult.fin = Math.max(ult.fin, i.fin);
    else out.push(i);
  }
  return out;
}

/** base − ocupaciones, ambos normalizados por dentro. El corazón del motor. */
export function restarIntervalos(
  base: ReadonlyArray<IntervaloMin>,
  ocupaciones: ReadonlyArray<IntervaloMin>,
): IntervaloMin[] {
  const libres = normalizar(base);
  const ocupadas = normalizar(ocupaciones);
  const out: IntervaloMin[] = [];
  for (const b of libres) {
    let cursor = b.inicio;
    for (const o of ocupadas) {
      if (o.fin <= cursor) continue; // ocupación ya pasada
      if (o.inicio >= b.fin) break; // ocupaciones ordenadas: nada más toca
      if (o.inicio > cursor) out.push({ inicio: cursor, fin: Math.min(o.inicio, b.fin) });
      cursor = Math.max(cursor, o.fin);
      if (cursor >= b.fin) break;
    }
    if (cursor < b.fin) out.push({ inicio: cursor, fin: b.fin });
  }
  return out;
}

// ─── La disponibilidad de UN doctor en UN día ───────────────────────────────

/** Franjas del día − (bloqueos + citas), todo ya proyectado a minutos del
 *  MISMO día local. Sin franjas ese día = no trabaja = []. */
export function disponibilidadDia(p: {
  franjas: ReadonlyArray<FranjaDia>;
  /** Citas Y bloqueos del doctor, proyectados al día (ver proyectarAlDia). */
  ocupaciones: ReadonlyArray<IntervaloMin>;
}): IntervaloMin[] {
  const base = p.franjas.map((f) => ({ inicio: aMin(f.inicio), fin: aMin(f.fin) }));
  return restarIntervalos(base, p.ocupaciones);
}

/** Trocea los huecos libres en slots ofertables de un tratamiento.
 *
 *  La huella de un slot es bufferAntes + duración + bufferDespués; lo que se
 *  ofrece (inicio/fin del slot) es el tiempo del TRATAMIENTO. Los slots son
 *  CONTIGUOS (paso = huella): «16:00 · 16:30 · 17:00», no la lista solapada
 *  cada 10 min del motor viejo, que nadie podía leer. */
export function trocearEnSlots(
  libres: ReadonlyArray<IntervaloMin>,
  p: { duracionMin: number; bufferAntesMin?: number; bufferDespuesMin?: number },
): IntervaloMin[] {
  if (!Number.isInteger(p.duracionMin) || p.duracionMin <= 0) {
    throw new Error(`duración inválida: ${p.duracionMin} — sin duración configurada no se calculan huecos`);
  }
  const antes = Math.max(0, p.bufferAntesMin ?? 0);
  const despues = Math.max(0, p.bufferDespuesMin ?? 0);
  const huella = antes + p.duracionMin + despues;
  const out: IntervaloMin[] = [];
  for (const l of normalizar(libres)) {
    let cursor = l.inicio;
    while (cursor + huella <= l.fin) {
      out.push({ inicio: cursor + antes, fin: cursor + antes + p.duracionMin });
      cursor += huella;
    }
  }
  return out;
}

// ─── Proyección de instantes absolutos al día local ─────────────────────────

/** Recorta un intervalo absoluto (cita o bloqueo, timestamptz de la base) a
 *  los minutos que pisa de `fecha` (YYYY-MM-DD, día local de la clínica).
 *  null = no toca ese día. Un bloqueo de varios días proyecta 00:00–24:00 en
 *  los días interiores. La conversión usa la MISMA zona que todo el producto
 *  (lib/time.TZ_CLINICA), inyectable para el QA. */
export function proyectarAlDia(
  intervalo: { inicio: Date; fin: Date },
  fecha: string,
  tz: string = TZ_CLINICA,
): IntervaloMin | null {
  if (!(intervalo.fin > intervalo.inicio)) return null;
  const diaInicio = hoyISO(intervalo.inicio, tz);
  const diaFin = hoyISO(intervalo.fin, tz);
  if (fecha < diaInicio || fecha > diaFin) return null;
  const desde = fecha === diaInicio ? aMin(horaClinica(intervalo.inicio, tz)) : 0;
  // Día interior o fin en un día posterior: este día queda pisado hasta las
  // 24:00. Fin dentro de este día: hasta su hora local — y un fin EXACTO a
  // las 00:00 de este día da hasta=0 ≤ desde, o sea null: no lo pisa.
  const hasta = fecha === diaFin ? aMin(horaClinica(intervalo.fin, tz)) : 24 * 60;
  if (hasta <= desde) return null;
  return { inicio: desde, fin: hasta };
}

/** Las franjas de horarios_staff de un doctor para un día concreto.
 *  `dia_semana` es ISO (1=lunes … 7=domingo); la fecha decide qué filas
 *  aplican. Fila con formato roto → lanza (aMin), jamás se ignora. */
export function franjasDelDia(
  filas: ReadonlyArray<{ dia_semana: number; inicio: string; fin: string }>,
  fecha: string,
): FranjaDia[] {
  const dia = diaSemanaISO(fecha);
  return filas.filter((f) => f.dia_semana === dia).map((f) => ({ inicio: f.inicio, fin: f.fin }));
}

/** 1=lunes … 7=domingo para un YYYY-MM-DD (aritmética de calendario pura:
 *  la fecha local YA es local — aquí no interviene ninguna zona). */
export function diaSemanaISO(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0=domingo
  return dow === 0 ? 7 : dow;
}
