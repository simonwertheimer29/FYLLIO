// app/lib/pacientes/busqueda.ts
//
// LA FRONTERA con el sistema del cliente (spec 2026-07-29, punto 6).
//
// Todo el producto busca pacientes por UNA función: `buscarPacientes`. Hoy
// consulta Postgres. Cuando se decida de dónde salen los pacientes con
// historial que aún no están en Fyllio —migrarlos del PMS del cliente, o
// leerlos en vivo—, se cambia lo que hay DENTRO de esta función y ni la UI ni
// el flujo se enteran: el modal recibe la misma lista de `PacienteEncontrado`.
//
// Lo que la frontera exige del otro lado, y está anotado en DECISIONES como
// supuesto validado: **el paciente migrado necesita un identificador estable**
// al que colgar sus presupuestos. Si el PMS no lo expone, leer de él solo
// sirve para consultar, y migrar pasa a ser la única vía.
//
// Server-only. Corre dentro del contexto de cliente del caller, como los repos.

import { listPacientes } from "./pacientes";
import { listClinicas } from "../auth/users";
import { currentCliente } from "../airtable";
import { listLeads } from "../leads/leads";
import { hoyISO } from "../time";

/** Lo que el buscador necesita saber de una persona para elegirla. */
export type PacienteEncontrado = {
  id: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
};

/** Un lead que ya tiene cita: el paciente todavía no existe porque nadie ha
 *  marcado su asistencia. */
export type LeadCitadoEncontrado = {
  id: string;
  nombre: string;
  telefono: string | null;
  clinicaNombre: string | null;
  fechaCita: string | null;
  horaCita: string | null;
  /** Cita hoy y sin asistencia marcada: es el caso que hay que resolver ya. */
  esDeHoySinAsistencia: boolean;
};

/** Sin acentos, sin mayúsculas y sin dobles espacios: "MARÍA josé" encuentra a
 *  "Maria Jose". `normalize("NFD")` separa la tilde de la letra para poder
 *  borrarla. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Solo los dígitos: "+34 630 870 630" y "630870630" son el mismo teléfono. */
const soloDigitos = (s: string) => s.replace(/\D/g, "");

/** true si lo tecleado parece un teléfono y no un nombre. */
function pareceTelefono(q: string): boolean {
  const d = soloDigitos(q);
  return d.length >= 3 && d.length >= normalizar(q).replace(/\s/g, "").length - 3;
}

/**
 * Coincidencia tolerante: por partes del nombre en cualquier orden ("olmedo
 * abril" encuentra a "Abril Olmedo") o por teléfono si se teclean dígitos.
 */
function coincide(q: string, nombre: string, telefono: string | null): boolean {
  const nq = normalizar(q);
  if (!nq) return false;
  if (pareceTelefono(q)) {
    const d = soloDigitos(q);
    return !!telefono && soloDigitos(telefono).includes(d);
  }
  const nNombre = normalizar(nombre);
  return nq.split(" ").every((parte) => nNombre.includes(parte));
}

/**
 * ORIGEN DEL PACIENTE (spec punto 5): quiénes nacieron de un lead (captación) y
 * quiénes ya existían (historial). Se deriva de `leads.paciente_id`, que es el
 * lado que el producto SÍ escribe (`markLeadConvertido`).
 *
 * Medido el 2026-07-29: la columna `pacientes.lead_origen_id` existe en el
 * esquema y está VACÍA en los 166 pacientes de DEMO — nadie la escribe nunca.
 * Rellenarla ahora crearía una segunda verdad que se desincroniza; se deriva,
 * igual que la cita del lead en MEJORAS 50. Por eso el punto 5 no necesita
 * esquema nuevo: necesita mirar al lado correcto.
 *
 * Vive FUERA del buscador a propósito: el picker no enseña el origen, y
 * calcularlo ahí costaba una carga entera de leads por cada tecla (el buscador
 * tardaba 2,3 s por pulsación). Lo consume quien mide, no quien busca.
 */
export async function idsDePacientesDeCaptacion(
  clinicaIds: string[] | null,
): Promise<Set<string>> {
  const leads = await listLeads({ clinicaIds: clinicaIds ?? undefined });
  const ids = new Set<string>();
  for (const l of leads) if (l.pacienteId) ids.add(l.pacienteId);
  return ids;
}

export async function buscarPacientes(params: {
  q: string;
  /** null = todas las clínicas accesibles (admin). */
  clinicaIds: string[] | null;
  limite?: number;
}): Promise<PacienteEncontrado[]> {
  const q = params.q.trim();
  if (q.length < 2) return [];
  // El nombre de la clínica se resuelve aquí: `listPacientes` no lo trae, y sin
  // él dos "María García" de clínicas distintas son indistinguibles — y, peor,
  // el presupuesto que se cree acabaría sin clínica.
  const [pacientes, clinicas] = await Promise.all([
    listPacientes({ clinicaIds: params.clinicaIds ?? undefined }),
    listClinicas({ onlyActivas: true, cliente: currentCliente() ?? undefined }),
  ]);
  const nombrePorClinica = new Map(clinicas.map((c) => [c.id, c.nombre]));
  const encontrados = pacientes
    .filter((p) => p.activo !== false && coincide(q, p.nombre, p.telefono))
    .map<PacienteEncontrado>((p) => ({
      id: p.id,
      nombre: p.nombre,
      telefono: p.telefono,
      clinicaId: p.clinicaId,
      clinicaNombre: p.clinicaNombre ?? (p.clinicaId ? nombrePorClinica.get(p.clinicaId) ?? null : null),
    }));
  // El que empieza por lo tecleado, primero: buscar "mar" debe ofrecer a
  // "María" antes que a "Ana Marín".
  const nq = normalizar(q);
  encontrados.sort((a, b) => {
    const ea = normalizar(a.nombre).startsWith(nq) ? 0 : 1;
    const eb = normalizar(b.nombre).startsWith(nq) ? 0 : 1;
    return ea - eb || a.nombre.localeCompare(b.nombre, "es");
  });
  return encontrados.slice(0, params.limite ?? 8);
}

/**
 * Leads CON CITA que coinciden con lo buscado. Solo se consulta cuando no hay
 * ningún paciente: sirve para decir "esta persona existe, pero todavía no es
 * paciente porque falta marcar su asistencia".
 *
 * Orden: primero el citado HOY sin asistencia marcada (el caso que la
 * coordinadora tiene delante), después el resto por proximidad de la cita.
 */
export async function buscarLeadsCitados(params: {
  q: string;
  clinicaIds: string[] | null;
  limite?: number;
}): Promise<LeadCitadoEncontrado[]> {
  const q = params.q.trim();
  if (q.length < 2) return [];
  const hoy = hoyISO();
  const leads = await listLeads({ clinicaIds: params.clinicaIds ?? undefined });
  const candidatos = leads
    .filter((l) => !l.convertido && !!l.fechaCita && coincide(q, l.nombre, l.telefono))
    .map<LeadCitadoEncontrado>((l) => ({
      id: l.id,
      nombre: l.nombre,
      telefono: l.telefono,
      clinicaNombre: l.clinicaNombre ?? null,
      fechaCita: l.fechaCita,
      horaCita: l.horaCita,
      esDeHoySinAsistencia: l.fechaCita === hoy && !l.asistido,
    }));
  candidatos.sort((a, b) => {
    if (a.esDeHoySinAsistencia !== b.esDeHoySinAsistencia) {
      return a.esDeHoySinAsistencia ? -1 : 1;
    }
    return (a.fechaCita ?? "").localeCompare(b.fechaCita ?? "");
  });
  return candidatos.slice(0, params.limite ?? 5);
}
