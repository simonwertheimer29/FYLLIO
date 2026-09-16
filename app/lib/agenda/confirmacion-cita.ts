// app/lib/agenda/confirmacion-cita.ts
//
// LA CONFIRMACIÓN DE CITA AL PACIENTE (17-09, paso 3 de la ficha).
//
// PLANTILLA DE CÓDIGO, SIN MODELO (decisión de Simon): la cita EXISTE cuando se
// escribe esto, así que afirmarla no es inventar nada — el veto de «cita
// inventada» del juez protege justo lo contrario. No pasa por el juez: el
// clic de la coordinadora es la revisión, y para que lo sea tiene que VER
// este texto entero ANTES de pulsar. Por eso es una función PURA que usan los
// dos lados: el panel la enseña para el hueco elegido y la ruta de confirmar
// la recompone desde la cita real ya reservada — mismo texto por
// construcción, no por confianza.
//
// Lo que dice y lo que no: día, hora, doctor y clínica (lo que consta). Nada
// de tratamiento (dato de salud que el paciente no ha pedido ver escrito —
// regla del dato no pedido) ni de precio. Y una salida: si no le viene bien,
// que lo diga por aquí — es la puerta del paso 3b («no me viene bien»).

import { fechaClinica } from "../time";

export type DatosConfirmacion = {
  nombre: string;
  /** YYYY-MM-DD, día de clínica. */
  fecha: string;
  /** HH:MM. */
  hora: string;
  doctor: string | null;
  clinica: string | null;
};

const primerNombre = (n: string): string => n.trim().split(/\s+/)[0] ?? n;

export function textoConfirmacionCita(d: DatosConfirmacion): string {
  const dia = fechaClinica(d.fecha, { diaSemana: true, mesLargo: true });
  const con = d.doctor ? ` con ${d.doctor}` : "";
  const donde = d.clinica ? ` en ${d.clinica}` : "";
  return (
    `Hola, ${primerNombre(d.nombre)}. Te confirmamos tu cita${donde}: ${dia} a las ${d.hora}${con}. ` +
    `Si no te viene bien, dínoslo por aquí y buscamos otra hora.`
  );
}
