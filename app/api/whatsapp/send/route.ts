// app/api/whatsapp/send/route.ts
// POST → sends an outbound WhatsApp message via Twilio.
// Used by the ACTIONS panel to offer slots to recall/waitlist patients.

import { NextResponse } from "next/server";
import { sendWhatsAppMessage } from "../../../lib/whatsapp/send";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phone, message } = body as { phone?: string; message?: string };

    if (!phone || !message) {
      return NextResponse.json({ error: "phone and message are required" }, { status: 400 });
    }

    const to = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
    await sendWhatsAppMessage(to, message);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[whatsapp/send]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
