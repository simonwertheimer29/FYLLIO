// app/lib/configuraciones/configuraciones.ts
//
// Sprint 14b Bloque 0 — repositorio de Configuraciones_Clinica.
//
// Modelo: cada record es UNA opcion dentro de UNA categoria. Una clinica
// puede tener varias opciones por categoria (ej: 5 metodos de pago) y
// cuando NO tiene ninguna opcion en una categoria, el codigo cae al
// default global (records con Clinica_Link = []).
//
// Esto permite que cada clinica adapte su workflow sin tocar codigo, y
// que las clinicas que no han customizado nada hereden lo razonable.

import { base, TABLES, fetchAll } from "../airtable";

export type ConfigCategoria =
  | "Metodos_Pago"
  | "Plazos_Liquidacion"
  | "Razones_No_Interesado"
  | "Plantillas_Scope";

export type ConfigOpcion = {
  id: string;
  clinicaId: string | null; // null = global default
  categoria: ConfigCategoria;
  valor: string;
  activo: boolean;
  orden: number;
  createdAt: string;
};

function toOpcion(rec: any): ConfigOpcion {
  const f = rec.fields ?? {};
  const links = (f["Clinica_Link"] ?? []) as string[];
  return {
    id: rec.id,
    clinicaId: links[0] ?? null,
    categoria: String(f["Categoria"] ?? "Metodos_Pago") as ConfigCategoria,
    valor: String(f["Valor"] ?? ""),
    activo: Boolean(f["Activo"] ?? true),
    orden: Number(f["Orden"] ?? 0) || 0,
    createdAt: String(
      f["Created_At"] ?? rec._rawJson?.createdTime ?? rec.createdTime ?? "",
    ),
  };
}

/**
 * Lista TODAS las opciones (globales + por clinica) — uso interno y
 * panel admin. Para consumo a runtime usa getOpcionesActivasParaClinica.
 */
export async function listAllOpciones(): Promise<ConfigOpcion[]> {
  const recs = await fetchAll(base(TABLES.configuracionesClinica as any).select({}));
  return recs.map(toOpcion);
}

/**
 * Devuelve las opciones activas para (clinicaId, categoria) con la
 * regla de fallback: si la clinica tiene >=1 opcion activa en esa
 * categoria, usamos las suyas; si no, devolvemos las globales activas.
 *
 * Esta semantica significa que añadir 1 opcion custom para una clinica
 * sustituye TODA la lista global. Es lo que la coordinadora espera:
 * "yo no quiero los defaults; quiero estos N que defini". Si quiere
 * extender los globales, los re-añade explicitamente desde el panel.
 */
export async function getOpcionesActivasParaClinica(args: {
  clinicaId: string | null;
  categoria: ConfigCategoria;
}): Promise<ConfigOpcion[]> {
  const all = await listAllOpciones();
  const sameCat = all.filter((o) => o.categoria === args.categoria && o.activo);
  if (args.clinicaId) {
    const propias = sameCat.filter((o) => o.clinicaId === args.clinicaId);
    if (propias.length > 0) {
      return propias.sort((a, b) => a.orden - b.orden || a.valor.localeCompare(b.valor));
    }
  }
  // Fallback: globales (clinicaId === null).
  return sameCat
    .filter((o) => o.clinicaId === null)
    .sort((a, b) => a.orden - b.orden || a.valor.localeCompare(b.valor));
}

/** Lee un valor escalar (ej. plazo de liquidacion en dias). Si la
 *  clinica no lo configuro, fallback al global. Si tampoco hay global,
 *  devuelve `defaultValue`. Numerico en string -> number. */
export async function getOpcionEscalar(args: {
  clinicaId: string | null;
  categoria: ConfigCategoria;
  defaultValue: number;
}): Promise<number> {
  const opts = await getOpcionesActivasParaClinica({
    clinicaId: args.clinicaId,
    categoria: args.categoria,
  });
  const first = opts[0];
  if (!first) return args.defaultValue;
  const n = Number(first.valor);
  return Number.isFinite(n) ? n : args.defaultValue;
}

export async function crearOpcion(input: {
  clinicaId: string | null;
  categoria: ConfigCategoria;
  valor: string;
  orden?: number;
}): Promise<ConfigOpcion> {
  const fields: Record<string, unknown> = {
    Resumen: `${input.categoria} · ${input.valor}${input.clinicaId ? ` · clinica` : ` · global`}`,
    Categoria: input.categoria,
    Valor: input.valor,
    Activo: true,
    Orden: input.orden ?? 0,
    Created_At: new Date().toISOString(),
  };
  if (input.clinicaId) fields["Clinica_Link"] = [input.clinicaId];
  const created = (
    await base(TABLES.configuracionesClinica as any).create([{ fields } as any])
  )[0]!;
  return toOpcion(created);
}

export async function actualizarOpcion(
  id: string,
  patch: Partial<{ valor: string; activo: boolean; orden: number }>,
): Promise<ConfigOpcion> {
  const fields: Record<string, unknown> = {};
  if (patch.valor !== undefined) fields["Valor"] = patch.valor;
  if (patch.activo !== undefined) fields["Activo"] = patch.activo;
  if (patch.orden !== undefined) fields["Orden"] = patch.orden;
  const updated = (
    await base(TABLES.configuracionesClinica as any).update([{ id, fields } as any])
  )[0]!;
  return toOpcion(updated);
}

export async function eliminarOpcion(id: string): Promise<void> {
  await base(TABLES.configuracionesClinica as any).destroy([id]);
}

/** UX label legible para Categoria. */
export const CATEGORIA_LABEL: Record<ConfigCategoria, string> = {
  Metodos_Pago: "Métodos de pago",
  Plazos_Liquidacion: "Plazos de liquidación",
  Razones_No_Interesado: "Razones de \"No Interesado\"",
  Plantillas_Scope: "Plantillas WhatsApp",
};
