// app/api/push/suscribir/route.ts
// POST: guardar/actualizar suscripción Web Push
// DELETE: desactivar suscripción

import { findSuscripcionPorEndpointRaw, updateSuscripcionRaw, createSuscripcionRaw } from "../../../lib/push/sender";
import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

// Sprint B — migrado a withPresupuestosAuth: fija el contexto de cliente para
// que base() resuelva la base correcta (antes 500 por el fail-closed).
export const dynamic = "force-dynamic";

export const POST = withPresupuestosAuth(async (session, req) => {
  try {
    const { subscription } = await req.json() as {
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    };

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });
    }

    const userEmail = session.email ?? "";
    const clinica = session.clinica ?? "";
    const userAgent = req.headers.get("user-agent") ?? "";

    // Buscar suscripción existente por endpoint
    const existingRec = await findSuscripcionPorEndpointRaw(subscription.endpoint);
    const existing = existingRec ? [existingRec] : [];

    if (existing.length > 0) {
      // Actualizar keys + reactivar
      await updateSuscripcionRaw(existing[0].id, {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        activa: true,
        user_agent: userAgent,
      });
    } else {
      // Crear nuevo registro
      const now = new Date().toISOString();
      await createSuscripcionRaw({
        user_email: userEmail,
        clinica,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent,
        activa: true,
        creada_en: now,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/suscribir] POST error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const DELETE = withPresupuestosAuth(async (_session, req) => {
  try {
    const { endpoint } = await req.json() as { endpoint: string };
    if (!endpoint) return NextResponse.json({ error: "endpoint requerido" }, { status: 400 });

    const existingRec2 = await findSuscripcionPorEndpointRaw(endpoint);
    const existing = existingRec2 ? [existingRec2] : [];

    if (existing.length > 0) {
      await updateSuscripcionRaw(existing[0].id, { activa: false });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/suscribir] DELETE error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
