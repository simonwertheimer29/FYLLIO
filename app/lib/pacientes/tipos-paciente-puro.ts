// app/lib/pacientes/tipos-paciente-puro.ts
//
// La parte del catálogo de tipos de paciente que es PURA y por tanto
// client-safe. Vive separada de `tipos-paciente.ts` porque aquel lee de la base
// (configuraciones → db/context → async_hooks) y arrastrarlo a un componente
// de navegador rompe el bundle: lo cazó el importador de CSV.
//
// Regla del repo: si una función la necesita el navegador, no puede vivir en el
// mismo archivo que un repo.

export type TipoPacienteOpcion = {
  valor: string;
  /** La marca que sustituye a preguntar "¿se llama Adeslas?". */
  esAseguradora: boolean;
};

/**
 * Resuelve un texto suelto (una celda de CSV, por ejemplo) contra el catálogo.
 * Devuelve null si no hay coincidencia: **no adivina**. El importador escribía
 * "Adeslas" en cuanto veía "mutua" o "seguro", así que una clínica de Sanitas
 * habría importado a todos sus pacientes con la aseguradora equivocada.
 */
export function resolverTipoPaciente(
  texto: string | null | undefined,
  catalogo: TipoPacienteOpcion[],
): string | null {
  const t = (texto ?? "").trim().toLowerCase();
  if (!t) return null;
  const exacto = catalogo.find((o) => o.valor.toLowerCase() === t);
  if (exacto) return exacto.valor;
  // "adeslas seguros" o "mutua adeslas" → Adeslas, pero solo si el nombre de la
  // aseguradora aparece de verdad.
  const contenido = catalogo.find((o) => t.includes(o.valor.toLowerCase()));
  return contenido ? contenido.valor : null;
}
