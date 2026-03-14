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

    // Demo mode: if Twilio auth token not configured → simulate success
    // This ensures all "Send WhatsApp" buttons work during demo presentations
    if (!process.env.TWILIO_AUTH_TOKEN) {
      console.info("[whatsapp/send] DEMO MODE — simulating send to", phone);
      return NextResponse.json({ ok: true, demo: true });
    }

    const to = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
    await sendWhatsAppMessage(to, message);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[whatsapp/send]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
