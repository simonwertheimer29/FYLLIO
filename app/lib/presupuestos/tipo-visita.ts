// El tipo de visita, leído de una sola manera. Módulo PURO.
//
// Por qué existe (2026-07-30): /kpis enseñaba "1ª Visita: 0 · Con historial: 0"
// con 123 presupuestos en la base. La causa no era un cálculo: era que la ruta
// comparaba con el literal `"Primera Visita"` y el dato guardado es
// `"Primera visita"`. Una mayúscula dejaba dos KPIs a cero, y un cero no se
// distingue de "no hay ninguno" — el mismo problema de fondo que `?? []`.
//
// Y hay un segundo desajuste debajo: Leads escribe su propio vocabulario
// ("Primera visita" · "Revisión" · "Urgencia") y Presupuestos declaraba el suyo
// ("Primera Visita" · "Paciente con Historia"). La conversión lead→presupuesto
// copia el valor del lead tal cual, así que en la práctica solo circula el
// vocabulario de Leads. Aquí se leen los dos, sin que ninguna pantalla tenga
// que saber cuál le tocó.

/** Normaliza para comparar: sin tildes, sin mayúsculas, sin espacios de sobra. */
function normaliza(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function esPrimeraVisita(tipoVisita: string | null | undefined): boolean {
  return normaliza(tipoVisita) === "primera visita";
}

/** Paciente que ya venía: revisión, urgencia o el literal antiguo del módulo. */
export function esVisitaRecurrente(tipoVisita: string | null | undefined): boolean {
  const v = normaliza(tipoVisita);
  return v === "paciente con historia" || v === "revision" || v === "urgencia";
}

/** Las dos categorías que se miden, en orden de lectura. */
export const TIPOS_VISITA_MEDIDOS = ["Primera visita", "Paciente con Historia"] as const;

export function etiquetaTipoVisita(tipo: string): string {
  return esPrimeraVisita(tipo) ? "1ª visita" : "Ya era paciente";
}

/** ¿A cuál de las dos categorías pertenece este valor? `null` = a ninguna. */
export function categoriaTipoVisita(tipoVisita: string | null | undefined): string | null {
  if (esPrimeraVisita(tipoVisita)) return TIPOS_VISITA_MEDIDOS[0];
  if (esVisitaRecurrente(tipoVisita)) return TIPOS_VISITA_MEDIDOS[1];
  return null;
}
