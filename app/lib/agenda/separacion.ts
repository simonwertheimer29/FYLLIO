// app/lib/agenda/separacion.ts
//
// LAS HORAS DE UNA PROPUESTA SON ALTERNATIVAS (22-09, Simon). Dos horas del
// mismo día a menos de una hora son, para el paciente, la misma hora dos
// veces («14:00 y 14:20»), sea con el doctor que sea. La regla vive AQUÍ, en
// un módulo puro, porque la aplican tres sitios que no pueden divergir: la
// casilla de la pantalla (OfertaPanel), el servidor que crea la oferta
// (ofertas.ts) y la elección de las tres sugerencias (huecos-del-caso.ts).
// El listado que VE la coordinadora no la aplica: ella tiene que ver el día
// entero para elegir; lo que no puede es MANDAR dos horas pegadas.

/** Separación mínima entre dos horas del mismo día en un mismo mensaje. */
export const SEPARACION_MIN = 60;

type HoraDeDia = { fecha: string; hora: string };

const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** La hora de `lista` que queda pegada a `h` (mismo día, < 60 min), o null.
 *  La misma hora exacta con OTRO doctor también cuenta como pegada. */
export function pegadaA<T extends HoraDeDia>(h: HoraDeDia, lista: readonly T[]): T | null {
  return lista.find((x) => x.fecha === h.fecha && Math.abs(aMinutos(x.hora) - aMinutos(h.hora)) < SEPARACION_MIN) ?? null;
}

/** El primer par pegado de una propuesta, o null si todas se separan. */
export function primerPar<T extends HoraDeDia>(lista: readonly T[]): [T, T] | null {
  for (let i = 0; i < lista.length; i++) {
    const otra = pegadaA(lista[i]!, lista.slice(i + 1));
    if (otra) return [lista[i]!, otra];
  }
  return null;
}
