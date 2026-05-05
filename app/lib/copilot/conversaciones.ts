// app/lib/copilot/conversaciones.ts
//
// Sprint 16a Bloque 1 — repo de Conversaciones_Copilot.
//
// Cada conversación es un registro Airtable con el array de mensajes
// serializado como JSON en el campo `Mensajes`. Operaciones:
//
//   - listConversaciones: últimas N por (usuarioId, clinicaId).
//   - getConversacion: fetch + parse mensajes.
//   - createConversacion: nueva sesión, mensajes iniciales opcionales.
//   - appendMensajes: añade al array existente, recalcula count + Updated_At.
//   - cerrarConversacion: Activa=false (soft delete / archive).
//   - generarTitulo: deriva título legible del primer mensaje user.
//
// Truncado: si Mensajes serializados pasan de MAX_BYTES o se acumulan
// >= MAX_MENSAJES, el caller debería cerrar la actual y abrir una nueva
// con título "Continuación: …". La lógica vive en /api/copilot/chat.

import { base, fetchAll, TABLES } from "../airtable";
import type { CopilotMessage } from "../../components/copilot/types";

export const MAX_BYTES = 80_000;
export const MAX_MENSAJES = 50;
export const TITULO_MAX = 80;

export type ConversacionResumen = {
  id: string;
  titulo: string;
  mensajeCount: number;
  modeloUsado: string | null;
  createdAt: string;
  updatedAt: string;
  activa: boolean;
};

export type Conversacion = ConversacionResumen & {
  usuarioId: string;
  clinicaId: string | null;
  mensajes: CopilotMessage[];
};

function toResumen(rec: any): ConversacionResumen {
  const f = rec.fields ?? {};
  return {
    id: rec.id,
    titulo: String(f["Titulo"] ?? "(sin título)"),
    mensajeCount: typeof f["Mensaje_Count"] === "number" ? f["Mensaje_Count"] : 0,
    modeloUsado: f["Modelo_Usado"] ? String(f["Modelo_Usado"]) : null,
    createdAt: String(f["Created_At"] ?? rec._rawJson?.createdTime ?? ""),
    updatedAt: String(f["Updated_At"] ?? rec._rawJson?.createdTime ?? ""),
    activa: Boolean(f["Activa"] ?? false),
  };
}

function parseMensajes(raw: unknown): CopilotMessage[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CopilotMessage[];
    return [];
  } catch {
    return [];
  }
}

function toConversacion(rec: any): Conversacion {
  const f = rec.fields ?? {};
  const usuarioLinks = (f["Usuario_Link"] ?? []) as string[];
  const clinicaLinks = (f["Clinica_Link"] ?? []) as string[];
  return {
    ...toResumen(rec),
    usuarioId: usuarioLinks[0] ?? "",
    clinicaId: clinicaLinks[0] ?? null,
    mensajes: parseMensajes(f["Mensajes"]),
  };
}

export type ListParams = {
  usuarioId: string;
  clinicaId?: string | null;
  limit?: number;
  /** Por defecto solo activas. Pasa false para incluir archivadas. */
  soloActivas?: boolean;
};

export async function listConversaciones(
  params: ListParams,
): Promise<ConversacionResumen[]> {
  const { usuarioId, limit = 10, soloActivas = false } = params;
  const filters: string[] = [];
  filters.push(`FIND("${usuarioId}", ARRAYJOIN({Usuario_Link}, ","))`);
  if (soloActivas) filters.push(`{Activa} = TRUE()`);
  const filterByFormula =
    filters.length > 1 ? `AND(${filters.join(", ")})` : filters[0];

  const recs = await fetchAll(
    base(TABLES.conversacionesCopilot).select({
      filterByFormula,
      sort: [{ field: "Updated_At", direction: "desc" }],
      pageSize: Math.min(limit, 100),
    }),
  );
  return recs.slice(0, limit).map(toResumen);
}

export async function getConversacion(id: string): Promise<Conversacion | null> {
  try {
    const rec = await base(TABLES.conversacionesCopilot).find(id);
    return toConversacion(rec);
  } catch {
    return null;
  }
}

function generarTitulo(mensajes: CopilotMessage[]): string {
  const primerUser = mensajes.find((m) => m.role === "user");
  if (!primerUser) return "Conversación nueva";
  const txt = primerUser.content.trim().replace(/\s+/g, " ");
  return txt.length > TITULO_MAX ? txt.slice(0, TITULO_MAX - 1) + "…" : txt;
}

export type CreateParams = {
  usuarioId: string;
  clinicaId?: string | null;
  mensajes?: CopilotMessage[];
  modeloUsado?: string | null;
  /** Override del título (ej. "Continuación: …" tras truncado). */
  titulo?: string;
};

export async function createConversacion(
  params: CreateParams,
): Promise<Conversacion> {
  const mensajes = params.mensajes ?? [];
  const now = new Date().toISOString();
  const titulo = params.titulo ?? generarTitulo(mensajes);
  const fields: Record<string, any> = {
    Resumen: titulo,
    Usuario_Link: [params.usuarioId],
    Titulo: titulo,
    Mensajes: JSON.stringify(mensajes),
    Mensaje_Count: mensajes.length,
    Created_At: now,
    Updated_At: now,
    Activa: true,
  };
  if (params.clinicaId) fields.Clinica_Link = [params.clinicaId];
  if (params.modeloUsado) fields.Modelo_Usado = params.modeloUsado;

  const created = (await base(TABLES.conversacionesCopilot).create([{ fields }]))[0]!;
  return toConversacion(created);
}

export type AppendResult = {
  conversacion: Conversacion;
  truncado: boolean;
};

export async function appendMensajes(
  id: string,
  nuevos: CopilotMessage[],
  modeloUsado?: string | null,
): Promise<AppendResult> {
  const existing = await getConversacion(id);
  if (!existing) throw new Error(`Conversación ${id} no existe`);

  const merged = [...existing.mensajes, ...nuevos];
  const serialized = JSON.stringify(merged);
  const truncado =
    serialized.length >= MAX_BYTES || merged.length >= MAX_MENSAJES;

  const fields: Record<string, any> = {
    Mensajes: serialized,
    Mensaje_Count: merged.length,
    Updated_At: new Date().toISOString(),
  };
  if (modeloUsado) fields.Modelo_Usado = modeloUsado;

  const updated = (
    await base(TABLES.conversacionesCopilot).update([{ id, fields }])
  )[0]!;
  return { conversacion: toConversacion(updated), truncado };
}

export async function cerrarConversacion(id: string): Promise<void> {
  await base(TABLES.conversacionesCopilot).update([
    { id, fields: { Activa: false, Updated_At: new Date().toISOString() } },
  ]);
}
