// app/lib/twilio/twiml.ts

// Escapar caracteres para que el XML no se rompa
function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function twimlMessage(text: string) {
  const safe = escapeXml(text);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${safe}</Message>
</Response>`;
}
