// app/api/alertas/enviar/route.ts
// Sprint 8 D.7 — envía alerta por WhatsApp a la coordinadora de la clínica.
// Respeta cooldown 2h por (clinicaId, tipoAlerta) + registra en Alertas_Enviadas.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { findCoordinacionesByClinica } from "../../../lib/auth/users";
import { calcularAlertas } from "../../../lib/alertas/calcular";
import { checkCooldown, recordAlert } from "../../../lib/alertas/historial";
import { renderAlertaMessage, type TipoAlerta } from "../../../lib/alertas/templates";

export const dynamic = "force-dynamic";

async function sendViaTwilio(to: string, body: string): Promise<{ ok: boolean; detail?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !from) {
    return { ok: false, detail: "Twilio no configurado (TWILIO_* env vars faltan)" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: to, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, detail: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch error" };
  }
}

export const POST = withAdmin(async (session, req) => {
  const body = (await req.json().catch(() => null)) as {
    clinicaId?: string;
    tipoAlerta?: TipoAlerta;
  } | null;
  const clinicaId = body?.clinicaId;
  const tipo = body?.tipoAlerta;
  if (!clinicaId || !tipo) {
    return NextResponse.json({ error: "clinicaId y tipoAlerta requeridos" }, { status: 400 });
  }
  if (!["leads", "presupuestos", "citados", "asistencias", "automatizaciones"].includes(tipo)) {
    return NextResponse.json({ error: "tipoAlerta inválido" }, { status: 400 });
  }

  // Cooldown
  const cd = await checkCooldown(clinicaId, tipo);
  if (cd.blocked) {
    return NextResponse.json(
      { error: "Alerta enviada recientemente", retryAfterMs: cd.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(cd.retryAfterMs / 1000)) } }
    );
  }

  // Clínica
  const cliRec = await base(TABLES.clinics).find(clinicaId).catch(() => null);
  if (!cliRec) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  const clinicaNombre = String(cliRec.fields?.["Nombre"] ?? "");

  // Coordinadora destinataria (primer activo con teléfono)
  const coords = await findCoordinacionesByClinica(clinicaId);
  const coord = coords.find((c) => c.activo && c.telefono) ?? coords.find((c) => c.activo);
  if (!coord) {
    return NextResponse.json(
      { error: "Ninguna coordinadora activa asignada a esta clínica" },
      { status: 400 }
    );
  }
  if (!coord.telefono) {
    return NextResponse.json(
      {
        error:
          "Falta teléfono de la coordinadora. Edítala en Ajustes → Clínica y equipo.",
      },
      { status: 400 }
    );
  }

  // Recalcular el count actual (evita stale state desde UI).
  const all = await calcularAlertas();
  const entry = all.find((a) => a.clinicaId === clinicaId);
  const n = entry?.counts[tipo] ?? 0;
  if (n === 0) {
    return NextResponse.json(
      { error: "Ya no hay situaciones pendientes de este tipo" },
      { status: 409 }
    );
  }

  const mensaje = renderAlertaMessage(tipo, { nombre: coord.nombre, clinica: clinicaNombre, n });

  // Enviar por WhatsApp
  const tel = coord.telefono.startsWith("+") ? coord.telefono : `+${coord.telefono}`;
  const result = await sendViaTwilio(`whatsapp:${tel}`, mensaje);

  // Registrar SIEMPRE (ok o error) para auditoría.
  await recordAlert({
    clinicaId,
    tipo,
    adminId: session.userId,
    coordinadoraId: coord.id,
    mensaje,
    error: !result.ok,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "No se pudo enviar el WhatsApp", detail: result.detail },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    sentAt: new Date().toISOString(),
    cooldownUntilMs: Date.now() + 2 * 60 * 60 * 1000,
  });
});
