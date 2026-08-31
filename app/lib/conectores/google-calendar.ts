// NIVEL 2 — el conector de Google Calendar. LO ÚNICO específico de Google
// del nivel 2: si mañana llega un PMS, este archivo se ignora y se escribe
// otro contra el mismo contrato (lib/conectores/tipos).
//
// Autenticación: CUENTA DE SERVICIO (decisión dictada — la clínica comparte
// su calendario con nuestra dirección; cero OAuth, cero caducidad de 7 días
// del modo testing). GOOGLE_SERVICE_ACCOUNT_JSON trae el JSON completo de la
// cuenta (client_email + private_key). OAuth llegará con el primer cliente
// real; este módulo solo cambiaría en cómo obtiene el access token.
//
// Sync: incremental con syncToken (cada pull trae solo lo que cambió).
// 410 GONE = el token caducó → se pide pull completo. Los eventos marcados
// «disponible» (transparency=transparent) NO ocupan: en incremental llegan
// como borrado para purgar el opaco que pudieran haber sido antes.

import { createSign } from "node:crypto";
import type { ConectorAgenda, OcupacionLeida, ResultadoPull } from "./tipos";
import { instanteDeCita } from "../agenda/cita-de-lead";

type Credencial = { client_email: string; private_key: string };

/** La dirección con la que la clínica comparte su calendario. null = la
 *  capacidad no está configurada (entorno §11: declarada en lib/entorno). */
export function emailServicioGoogle(): string | null {
  const c = leerCredencial();
  return c ? c.client_email : null;
}

function leerCredencial(): Credencial | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Credencial>;
    if (typeof j.client_email === "string" && typeof j.private_key === "string") {
      return { client_email: j.client_email, private_key: j.private_key };
    }
    return null;
  } catch {
    // caída-declarada: JSON malformado = capacidad no configurada; el sync
    // fallará con motivo legible, no con un throw críptico aquí.
    return null;
  }
}

// Access token cacheado por instancia (serverless: cache débil, suficiente —
// pedir uno nuevo cuesta una llamada, no un fallo).
let tokenCache: { token: string; expira: number } | null = null;

const b64url = (s: string | Buffer) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(cred: Credencial): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expira - 60_000) return tokenCache.token;
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(
    JSON.stringify({
      iss: cred.client_email,
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: ahora,
      exp: ahora + 3600,
    }),
  );
  const firmador = createSign("RSA-SHA256");
  firmador.update(`${cabecera}.${cuerpo}`);
  const firma = b64url(firmador.sign(cred.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${cabecera}.${cuerpo}.${firma}`,
    }),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    throw new Error(`Google no aceptó la credencial (${r.status}): ${detalle.slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

// ── El mapeo evento → ocupación (donde viven los casos raros de Calendar) ──

export type EventoGoogle = {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/** Exportado para el QA determinista (qa:agenda-externa): aquí viven los
 *  casos raros de Calendar y aquí se afirman con fixtures. */
export function mapearEvento(e: EventoGoogle): { borrado: string } | { ocupacion: OcupacionLeida } | null {
  // Cancelado (en incremental llegan con showDeleted): purgar.
  if (e.status === "cancelled") return { borrado: e.id };
  // «Disponible» (transparent) NO ocupa — se trata como borrado para purgar
  // la versión opaca que pudiera existir de antes.
  if (e.transparency === "transparent") return { borrado: e.id };

  const diaEntero = Boolean(e.start?.date);
  // Día entero: Calendar da FECHAS sin hora (end exclusivo). La medianoche se
  // resuelve en la zona de la clínica con instanteDeCita — un offset fijo
  // aquí sería el bug de invierno (+02 en enero corre el bloqueo una hora).
  // Con dateTime, el ISO trae su propio offset y new Date lo resuelve.
  const inicio = e.start?.dateTime
    ? new Date(e.start.dateTime)
    : e.start?.date
      ? instanteDeCita(e.start.date, "00:00")
      : null;
  const fin = e.end?.dateTime
    ? new Date(e.end.dateTime)
    : e.end?.date
      ? instanteDeCita(e.end.date, "00:00")
      : null;
  if (!inicio || !fin) return null; // sin cuándo no hay ocupación
  if (!(fin > inicio)) return null;

  return {
    ocupacion: {
      externalId: e.id,
      inicio,
      fin,
      etiqueta: e.summary?.trim() || null,
      diaEntero,
      // Contrato: opcionales que Calendar no tiene — null EXPLÍCITO, no
      // adivinado del título.
      pacienteTexto: null,
      tratamientoTexto: null,
      sillonTexto: null,
    },
  };
}

export const conectorGoogleCalendar: ConectorAgenda = {
  fuente: "google_calendar",

  async pull({ referenciaExterna, desde, hasta, cursor }): Promise<ResultadoPull> {
    const cred = leerCredencial();
    if (!cred) {
      return { ok: false, motivo: "Falta GOOGLE_SERVICE_ACCOUNT_JSON — la lectura de Google Calendar no está configurada." };
    }
    let token: string;
    try {
      token = await accessToken(cred);
    } catch (e) {
      return { ok: false, motivo: e instanceof Error ? e.message : "No se pudo autenticar con Google." };
    }

    const ocupaciones: OcupacionLeida[] = [];
    const borrados: string[] = [];
    let pageToken: string | null = null;
    let cursorSiguiente: string | null = null;
    const esIncremental = cursor != null;

    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(referenciaExterna)}/events`,
      );
      // singleEvents expande los recurrentes: cada instancia es un intervalo.
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showDeleted", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      else if (esIncremental) url.searchParams.set("syncToken", cursor!);
      else {
        url.searchParams.set("timeMin", desde.toISOString());
        url.searchParams.set("timeMax", hasta.toISOString());
      }

      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 410) {
        // El syncToken caducó: Google exige releer entero.
        return { ok: false, motivo: "El cursor de sync caducó.", reintentarConPullCompleto: true };
      }
      if (r.status === 404) {
        return { ok: false, motivo: "Google no encuentra ese calendario — comprueba el identificador y que esté compartido con la cuenta de servicio." };
      }
      if (r.status === 403) {
        return { ok: false, motivo: "Google deniega el acceso al calendario — falta compartirlo con la cuenta de servicio (solo lectura)." };
      }
      if (!r.ok) {
        const detalle = await r.text().catch(() => "");
        return { ok: false, motivo: `Google Calendar respondió ${r.status}: ${detalle.slice(0, 200)}` };
      }
      const j = (await r.json()) as {
        items?: EventoGoogle[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      for (const e of j.items ?? []) {
        const m = mapearEvento(e);
        if (!m) continue;
        if ("borrado" in m) borrados.push(m.borrado);
        else ocupaciones.push(m.ocupacion);
      }
      pageToken = j.nextPageToken ?? null;
      if (j.nextSyncToken) cursorSiguiente = j.nextSyncToken;
    } while (pageToken);

    return { ok: true, ocupaciones, borrados, cursor: cursorSiguiente, completo: !esIncremental };
  },
};
