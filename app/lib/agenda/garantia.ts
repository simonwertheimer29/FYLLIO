// app/lib/agenda/garantia.ts
//
// LO QUE FYLLIO GARANTIZA SOBRE LOS HUECOS QUE ENSEÑA (17-09, paso 3 de la
// ficha — criterio de Simon: «la interfaz nunca afirma más de lo que la fuente
// garantiza»).
//
// La función de servidor que calcula huecos devuelve los huecos Y esto. La
// pantalla se COMPONE de esta respuesta —no de un flag por cliente que cada
// componente interprete a su manera— y por eso hay un solo camino de código
// con tres valores de frescura:
//
//   en_vivo   · la clínica declaró que su agenda real vive en Fyllio
//               (agenda_ajustes.agenda_en_fyllio). Un hueco calculado ES un
//               hueco; reservar ES reservar; se confirma al paciente.
//   copia     · hay una agenda externa conectada (Google Calendar hoy; el
//               lector del PMS mañana, por la misma puerta). Los huecos se
//               calculan sobre una FOTO con fecha: se dice de cuándo es y que
//               la cita se confirma en el software de la clínica.
//   sin_agenda· ni lo uno ni lo otro. Fyllio calcula sobre su configuración
//               (horarios, citas anotadas) y lo dice: el aviso de siempre.
//
// En en_vivo la frescura es trivial, y se enseña IGUAL (decisión de Simon):
// un solo camino, una etiqueta de cuánto fiarse — la coordinadora no tiene
// que saber en qué escalón está su clínica para leer el panel.

import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "../db/types";

export type FrescuraAgenda = "en_vivo" | "copia" | "sin_agenda";

export type GarantiaAgenda = {
  frescura: FrescuraAgenda;
  /** ISO de la foto en `copia` (la lectura más ANTIGUA entre los doctores
   *  implicados: la garantía es la del peor). null en en_vivo y sin_agenda. */
  desdeISO: string | null;
  /** Reservar desde aquí es una reserva REAL en la agenda de verdad. Solo en
   *  en_vivo. En los otros dos, «anotar» crea la cita en Fyllio y la clínica
   *  la confirma en su software (MEJORAS 258). */
  puedeReservar: boolean;
  /** Si alguna agenda externa implicada está rota (sin lectura buena o con
   *  error): sus huecos NO se enseñan (jamás huecos frescos sobre lectura
   *  rancia, regla del 31-08). Aquí va el motivo, para decirlo. */
  fuentesRotas: string[];
  /** La frase para la coordinadora. Compuesta aquí, una sola vez. */
  texto: string;
};

export type AgendaExternaImplicada = {
  staffId: string;
  fuente: string;
  ultimoSyncOk: Date | null;
  ultimoError: string | null;
};

const fechaHoraCorta = (d: Date): string =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(d);

/** PURA. Con lo que consta, qué se garantiza. `externas` son solo las agendas
 *  externas de los doctores IMPLICADOS en la respuesta (no todas). */
export function garantiaDe(p: { agendaEnFyllio: boolean; externas: readonly AgendaExternaImplicada[] }): GarantiaAgenda {
  if (p.agendaEnFyllio) {
    return {
      frescura: "en_vivo",
      desdeISO: null,
      puedeReservar: true,
      fuentesRotas: [],
      texto: "Agenda en vivo: estos huecos son reales y reservar los ocupa.",
    };
  }
  if (p.externas.length > 0) {
    const rotas = p.externas.filter((e) => !e.ultimoSyncOk || e.ultimoError);
    const sanas = p.externas.filter((e) => e.ultimoSyncOk && !e.ultimoError);
    const masAntigua = sanas.reduce<Date | null>((acc, e) => (acc == null || e.ultimoSyncOk! < acc ? e.ultimoSyncOk! : acc), null);
    return {
      frescura: "copia",
      desdeISO: masAntigua ? masAntigua.toISOString() : null,
      puedeReservar: false,
      fuentesRotas: rotas.map((r) => `${r.fuente} de ${r.staffId}`),
      texto: masAntigua
        ? `Copia de la agenda leída el ${fechaHoraCorta(masAntigua)}: los huecos se confirman en tu software antes de cerrarlos.`
        : "La lectura de la agenda externa está rota: no se pueden afirmar huecos hasta que vuelva.",
    };
  }
  return {
    frescura: "sin_agenda",
    desdeISO: null,
    puedeReservar: false,
    fuentesRotas: [],
    texto: "Estas horas libres no son reales — la agenda de verdad está en tu software.",
  };
}

/** ¿La clínica declaró que su agenda vive en Fyllio? Sin fila = no. */
export async function leerAgendaEnFyllio(trx: Transaction<DB> | Kysely<DB>): Promise<boolean> {
  const r: any = await sql`select agenda_en_fyllio from agenda_ajustes limit 1`.execute(trx);
  return r.rows?.[0]?.agenda_en_fyllio === true;
}
