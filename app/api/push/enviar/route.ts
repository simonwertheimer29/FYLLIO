// app/api/push/enviar/route.ts
// POST: enviar push notification (solo llamadas internas autenticadas con x-internal-secret)

import { NextResponse } from "next/server";
import { sendPushToClinica, sendPushToAll } from "../../../lib/push/sender";
import type { PushPayload } from "../../../lib/push/sender";

export async function POST(req: Request) {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.headers.get("x-internal-secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json() as PushPayload & { clinicaId?: string };
    const { title, body: msgBody, url, tag, clinicaId } = body;

    if (!title || !msgBody || !url || !tag) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    const payload: PushPayload = { title, body: msgBody, url, tag };
    const result = clinicaId !== undefined
      ? await sendPushToClinica(clinicaId, payload)
      : await sendPushToAll(payload);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[push/enviar] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
