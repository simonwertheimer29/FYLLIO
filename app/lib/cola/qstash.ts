// app/lib/cola/qstash.ts
//
// LA COLA DE TRABAJOS (plan maestro 0.1, MEJORAS 164). Decisión: QStash — push,
// sin worker, funciona en Vercel Hobby. Qué resuelve: `after()` no es una
// cola: muere con el timeout de la función y no reintenta. Aquí un trabajo se
// publica con clave de idempotencia, QStash lo entrega a /api/cola/trabajo,
// reintenta si respondemos 5xx y, cuando agota los reintentos, llama a
// /api/cola/fallo, que lo deja en `incidencias` — VISIBLE en el producto, no
// en un DLQ que nadie mira.
//
// Qué va a la cola HOY: solo el turno del evaluador (`evaluar_entrante`). Lo
// demás sigue en after() a propósito (DECISIONES 2026-09-06).
//
// Idempotencia en dos capas: `deduplicationId` de QStash (misma clave en la
// ventana de dedup = un solo mensaje) y, en el receptor, `turnoYaEvaluado`
// (un evento `evaluacion` con ese mensaje_id = no se vuelve a evaluar). La
// persistencia del turno ya era idempotente por (evento, clave, mensaje_id).
//
// Si la cola no está configurada (sin token, sin firma, sin URL pública — el
// portátil), `encolar` lo dice y el caller usa el camino de siempre. Nunca
// lanza: encolar no puede tumbar el webhook.

import { Client, Receiver } from "@upstash/qstash";
import type { Cliente } from "../airtable";
import type { EntranteAEvaluar } from "../agente/evaluar-entrante";

export const RUTA_TRABAJO = "/api/cola/trabajo";
export const RUTA_FALLO = "/api/cola/fallo";
/** Reintentos de QStash tras el primer intento (backoff exponencial suyo). */
export const REINTENTOS = 3;

const CLIENTES: ReadonlySet<string> = new Set(["RB", "INDEP", "DEMO"]);

export type TrabajoCola = {
  tipo: "evaluar_entrante";
  cliente: Cliente;
  entrada: EntranteAEvaluar;
  /** ISO — cuándo se encoló. Diagnóstico, no lógica. */
  encoladoEn: string;
};

/** URL pública a la que QStash nos llama. COLA_URL_BASE manda; en Vercel, la
 *  URL de producción que Vercel expone. En el portátil no hay (y no debe haber:
 *  QStash no llega a localhost). */
export function baseUrlPublica(): string | null {
  const explicita = process.env.COLA_URL_BASE?.trim();
  if (explicita) return explicita.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel && process.env.VERCEL_ENV === "production") return `https://${vercel}`;
  return null;
}

export type EstadoCola =
  | { activa: true; base: string }
  | { activa: false; motivo: "sin_token" | "sin_firma" | "sin_url_publica" };

export function estadoCola(): EstadoCola {
  if (!process.env.QSTASH_TOKEN) return { activa: false, motivo: "sin_token" };
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY) return { activa: false, motivo: "sin_firma" };
  const base = baseUrlPublica();
  if (!base) return { activa: false, motivo: "sin_url_publica" };
  return { activa: true, base };
}

export function claveTrabajo(t: Pick<TrabajoCola, "tipo" | "cliente" | "entrada">): string {
  return `${t.tipo}:${t.cliente}:${t.entrada.mensajeId}`;
}

/** Lo que llega por HTTP es de fuera aunque venga firmado: se valida la forma. */
export function parseTrabajo(body: string): TrabajoCola | null {
  try {
    const t = JSON.parse(body) as Partial<TrabajoCola> | null;
    if (!t || t.tipo !== "evaluar_entrante") return null;
    if (typeof t.cliente !== "string" || !CLIENTES.has(t.cliente)) return null;
    const e = t.entrada;
    if (!e || typeof e.telefono !== "string" || typeof e.mensajeId !== "string" || typeof e.contenido !== "string") return null;
    return t as TrabajoCola;
  } catch {
    return null;
  }
}

let avisadaInactiva = false;

export async function encolar(
  t: Omit<TrabajoCola, "encoladoEn">,
): Promise<{ encolado: true; qstashId: string } | { encolado: false; motivo: string }> {
  const estado = estadoCola();
  if (!estado.activa) {
    // Token presente pero cola inactiva es una configuración a medias: se dice
    // una vez por proceso, no en cada mensaje.
    if (estado.motivo !== "sin_token" && !avisadaInactiva) {
      avisadaInactiva = true;
      console.warn(`[cola] QSTASH_TOKEN presente pero la cola está inactiva (${estado.motivo}); los turnos corren en after()`);
    }
    return { encolado: false, motivo: estado.motivo };
  }
  const trabajo: TrabajoCola = { ...t, encoladoEn: new Date().toISOString() };
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN! });
    const r = await client.publishJSON({
      url: `${estado.base}${RUTA_TRABAJO}`,
      body: trabajo,
      retries: REINTENTOS,
      deduplicationId: claveTrabajo(trabajo),
      failureCallback: `${estado.base}${RUTA_FALLO}`,
    });
    const qstashId = (r as { messageId?: string }).messageId ?? "?";
    return { encolado: true, qstashId };
  } catch (err) {
    const { registrarIncidencia } = await import("../incidencias");
    await registrarIncidencia({
      tipo: "cola",
      motivo: "publicar_fallo",
      origen: "cola/qstash",
      clinicaId: t.entrada.clinicaId ?? null,
      referencia: t.entrada.mensajeId,
      error: err,
      cliente: t.cliente,
      reintentable: true,
    });
    return { encolado: false, motivo: "publicar_fallo" };
  }
}

/** Firma de QStash sobre el cuerpo crudo. Sin clave configurada o sin cabecera
 *  → false (fail-closed): cualquiera podría llamar a /api/cola/* si no. La
 *  URL se comprueba cuando conocemos la nuestra (misma constante con la que
 *  publicamos); si no, cuentan la firma, el cuerpo y la caducidad del token. */
export async function verificarFirmaQStash(req: Request, body: string, ruta: string): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  if (!currentSigningKey) return false;
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const base = baseUrlPublica();
  try {
    const receiver = new Receiver({
      currentSigningKey,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || currentSigningKey,
    });
    return await receiver.verify({ signature, body, ...(base ? { url: `${base}${ruta}` } : {}) });
  } catch {
    return false;
  }
}
