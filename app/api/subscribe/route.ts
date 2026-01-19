import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: Request) {
  const { email, fname, role, clinic } = await req.json();

  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  const apiKey = process.env.MAILCHIMP_API_KEY!;
  const listId = process.env.MAILCHIMP_AUDIENCE_ID!;
  const dc = apiKey.split("-")[1]; // ej: us21

  const subscriberHash = crypto.createHash("md5").update(email.toLowerCase()).digest("hex");

  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}`;

  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify({
      email_address: email,
      status_if_new: "subscribed",
      status: "subscribed",
      merge_fields: { FNAME: fname, ROLE: role, CLINIC: clinic },
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: t }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
