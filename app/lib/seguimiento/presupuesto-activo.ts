// app/lib/seguimiento/presupuesto-activo.ts
//
// EL PRESUPUESTO ACTIVO de una conversación (21-08, dictado): un paciente con
// dos presupuestos vivos es UN caso — y el activo no lo decide el importe,
// lo decide LA CONVERSACIÓN. Una sola pieza para la cola y la ficha (si cada
// una eligiera por su cuenta, la card y la ficha podrían señalar documentos
// distintos del mismo caso, que es el fallo que esto arregla).
//
// Fuentes, en orden — y la fuente SE DECLARA (condición dictada: un activo
// elegido en silencio es peor que dos cards):
//   1 · "conversacion": el evaluador capturó de QUÉ presupuesto habla el
//       último juicio (presupuestoReferidoId del payload). La verdad.
//   2 · "proxy": no hay captura — (a) el presupuesto donde el clasificador
//       viejo marcó señal (quiebre/intención), el más reciente de ellos;
//       (b) si tampoco, el EMITIDO más reciente (el que está sobre la mesa).
//       El proxy nace con fecha de muerte: muere cuando el evaluador esté
//       encendido y capture el referido en cada turno.

export type PresupuestoParaActivo = {
  id: string;
  importe: number | null;
  tratamiento: string | null;
  /** Fecha de emisión (ISO) — el desempate del proxy. */
  fechaISO: string | null;
  /** Señal del clasificador viejo sobre ESTE documento. */
  conSenalClasificador?: boolean;
};

export type PresupuestoActivo = {
  activo: PresupuestoParaActivo;
  otros: PresupuestoParaActivo[];
  fuente: "conversacion" | "proxy";
};

export function elegirPresupuestoActivo(
  vivos: readonly PresupuestoParaActivo[],
  opts?: { referidoId?: string | null },
): PresupuestoActivo | null {
  if (vivos.length === 0) return null;

  const porReciente = [...vivos].sort((a, b) => (b.fechaISO ?? "").localeCompare(a.fechaISO ?? ""));

  // 1 · La conversación lo dijo (juicio del evaluador con id resuelto).
  if (opts?.referidoId) {
    const referido = vivos.find((v) => v.id === opts.referidoId);
    if (referido) {
      return { activo: referido, otros: vivos.filter((v) => v.id !== referido.id), fuente: "conversacion" };
    }
    // Un referido que no está entre los vivos (cerrado desde entonces) no
    // manda: cae al proxy — jamás se señala un documento que ya no existe.
  }

  // 2a · Señal del clasificador (la única huella por-documento que la
  //      conversación deja hoy), la más reciente si hay varias.
  const conSenal = porReciente.find((v) => v.conSenalClasificador);
  const activo = conSenal ?? porReciente[0];
  return { activo, otros: vivos.filter((v) => v.id !== activo.id), fuente: "proxy" };
}
