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

// MEJORAS 45 (2026-07-27) — la memoria del Copilot vivía en Airtable sin pasar
// por el gate de backend. Ahora Postgres (tabla conversaciones_copilot).
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import type { CopilotMessage } from "../../components/copilot/types";
import { actualizarUna } from "../db/escritura";

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

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));

function toResumen(r: any): ConversacionResumen {
  return {
    id: r.id,
    titulo: String(r.titulo ?? "(sin título)"),
    mensajeCount: Number(r.mensaje_count ?? 0),
    modeloUsado: r.modelo_usado ? String(r.modelo_usado) : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at ?? r.created_at),
    activa: r.activa !== false,
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

function toConversacion(r: any): Conversacion {
  return {
    ...toResumen(r),
    usuarioId: r.usuario_id ?? "",
    clinicaId: r.clinica_id ?? null,
    mensajes: parseMensajes(r.mensajes),
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
  const cliente = requireCliente("listConversaciones");
  return runWithClienteDb(cliente, async (trx) => {
    let q = trx
      .selectFrom("conversaciones_copilot")
      .selectAll()
      .where("usuario_id", "=", usuarioId)
      .orderBy("updated_at", "desc")
      .limit(limit);
    if (soloActivas) q = q.where("activa", "=", true);
    const rows = await q.execute();
    return rows.map(toResumen);
  });
}

export async function getConversacion(id: string): Promise<Conversacion | null> {
  try {
    const cliente = requireCliente("getConversacion");
    const row = await runWithClienteDb(cliente, (trx) =>
      trx.selectFrom("conversaciones_copilot").selectAll().where("id", "=", id).executeTakeFirst(),
    );
    return row ? toConversacion(row) : null;
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
  const cliente = requireCliente("createConversacion");
  const row = await runWithClienteDb(cliente, (trx) =>
    trx
      .insertInto("conversaciones_copilot")
      .values({
        cliente,
        resumen: titulo,
        usuario_id: params.usuarioId,
        clinica_id: params.clinicaId ?? null,
        titulo,
        mensajes: JSON.stringify(mensajes),
        mensaje_count: mensajes.length,
        modelo_usado: params.modeloUsado ?? null,
        activa: true,
        updated_at: new Date(now),
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return toConversacion(row);
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

  const cliente = requireCliente("appendMensajes");
  const row = await runWithClienteDb(cliente, (trx) =>
    trx
      .updateTable("conversaciones_copilot")
      .set({
        mensajes: serialized,
        mensaje_count: merged.length,
        updated_at: new Date(),
        ...(modeloUsado ? { modelo_usado: modeloUsado } : {}),
      } as any)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return { conversacion: toConversacion(row), truncado };
}

export async function cerrarConversacion(id: string): Promise<void> {
  const cliente = requireCliente("cerrarConversacion");
  await runWithClienteDb(cliente, (trx) =>
    actualizarUna(
      trx
        .updateTable("conversaciones_copilot")
        .set({ activa: false, updated_at: new Date() } as any)
        .where("id", "=", id),
      "conversaciones_copilot",
      id,
    ),
  );
}
