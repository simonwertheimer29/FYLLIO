// app/lib/pacientes/tipos-paciente.ts
//
// El catálogo de tipos de paciente (spec 2026-07-29). SUSTITUYE al enum
// `TipoPaciente = "Adeslas" | "Privado"`, que estaba además clavado a mano en
// los KPIs, en la vista de Tarifas, en el importador CSV y en el portal del
// paciente: dar de alta una aseguradora exigía tocar cuatro capas y desplegar.
//
// Vive en `configuraciones_clinica`, el mismo sitio que los métodos de pago y
// las razones de descarte. DOS CATEGORÍAS, y la categoría ES la marca de
// aseguradora:
//
//   Tipos_Paciente              → los que NO son aseguradora (Privado)
//   Tipos_Paciente_Aseguradora  → las mutuas con las que trabaja la clínica
//
// Se hizo así en vez de meter un flag dentro del valor porque eso es
// exactamente el pecado que acabábamos de quitar de `presupuestos.notas`
// (metadatos colados en un campo de texto con separadores). La categoría es el
// vocabulario propio de la tabla y no cuesta esquema nuevo.
//
// La pregunta que importa aguas abajo NO es "¿se llama Adeslas?" sino
// "¿TIENE ASEGURADORA?" — de eso depende lo que el paciente ve en su portal.

import { getOpcionesActivasParaClinica } from "../configuraciones/configuraciones";
import type { TipoPacienteOpcion } from "./tipos-paciente-puro";

// Re-export para que el servidor tenga una sola puerta; el navegador importa
// directamente del módulo puro.
export { resolverTipoPaciente, type TipoPacienteOpcion } from "./tipos-paciente-puro";

export const CATEGORIA_PROPIO = "Tipos_Paciente" as const;
export const CATEGORIA_ASEGURADORA = "Tipos_Paciente_Aseguradora" as const;

/**
 * El catálogo de la clínica: primero los propios (Privado), después las
 * aseguradoras. Si la clínica no ha configurado nada, hereda los globales —
 * el mismo fallback que el resto de categorías.
 */
export async function catalogoTiposPaciente(
  clinicaId?: string | null,
): Promise<TipoPacienteOpcion[]> {
  const [propios, aseguradoras] = await Promise.all([
    getOpcionesActivasParaClinica({
      categoria: CATEGORIA_PROPIO,
      clinicaId: clinicaId ?? null,
    }),
    getOpcionesActivasParaClinica({
      categoria: CATEGORIA_ASEGURADORA,
      clinicaId: clinicaId ?? null,
    }),
  ]);
  return [
    ...propios.map((o) => ({ valor: o.valor, esAseguradora: false })),
    ...aseguradoras.map((o) => ({ valor: o.valor, esAseguradora: true })),
  ];
}

/** Solo los nombres, para validar contra el catálogo. */
export async function valoresTipoPaciente(clinicaId?: string | null): Promise<string[]> {
  return (await catalogoTiposPaciente(clinicaId)).map((t) => t.valor);
}

/**
 * ¿Este tipo es una aseguradora? La pregunta que sustituye a
 * `tipoPaciente === "Adeslas"` en todo el producto — y muy especialmente en el
 * portal del paciente, donde de ella depende que se vea el desglose de mutua.
 * Con la comparación literal, un paciente de Sanitas habría dejado de verlo sin
 * que nadie se enterara.
 */
export async function esAseguradora(
  tipo: string | null | undefined,
  clinicaId?: string | null,
): Promise<boolean> {
  if (!tipo) return false;
  const catalogo = await catalogoTiposPaciente(clinicaId);
  return catalogo.some((t) => t.esAseguradora && t.valor.toLowerCase() === tipo.toLowerCase());
}
