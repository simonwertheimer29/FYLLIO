import { NextResponse } from "next/server";
import { POST as WhatsAppPOST } from "../../twilio/whatsapp/route";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const From = body.From || "whatsapp:+34999999999";
  const Body = body.Body || "";
  const MessageSid = body.MessageSid || `SIM_${Date.now()}`;

  const form = new FormData();
  form.set("From", From);
  form.set("Body", Body);
  form.set("MessageSid", MessageSid);

  const twilioReq = new Request("http://local/twilio", { method: "POST", body: form });
  const res = await WhatsAppPOST(twilioReq as any);

  const text = await res.text();
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
