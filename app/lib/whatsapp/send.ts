// app/lib/whatsapp/send.ts
// Sends an outbound WhatsApp message via Twilio REST API (no npm package needed)

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"

  if (!accountSid || !authToken || !from) {
    console.warn("[sendWhatsApp] Missing Twilio env vars — message not sent", { to });
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const params = new URLSearchParams({ From: from, To: to, Body: body });

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
    console.error("[sendWhatsApp] Twilio error", res.status, text);
  } else {
    console.log("[sendWhatsApp] Sent to", to);
  }
}
