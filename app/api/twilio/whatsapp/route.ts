// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";


export async function POST(req: Request) {
  try {
    // Twilio manda "application/x-www-form-urlencoded"
    const form = await req.formData();

    // Campos típicos de Twilio WhatsApp
    const from = (form.get("From") as string) || "";   // "whatsapp:+34..."
    const body = (form.get("Body") as string) || "";   // texto del usuario
    const msgSid = (form.get("MessageSid") as string) || "";

    console.log("[twilio/whatsapp] inbound", { from, body, msgSid });

    // MVP: responder echo para confirmar que ya funciona end-to-end
    const reply = `✅ Recibido: "${body}"`;

    const xml = twimlMessage(reply);

    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("[twilio/whatsapp] ERROR", err);

    // A Twilio le da igual el texto, pero mejor responder algo válido
    const xml = twimlMessage("⚠️ Hubo un error procesando tu mensaje.");
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }
}

// Opcional: para probar en navegador que la ruta existe
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/twilio/whatsapp" });
}
