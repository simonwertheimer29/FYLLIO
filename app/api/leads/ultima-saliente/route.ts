// app/api/leads/ultima-saliente/route.ts
//
// Sprint 15 Bloque 7 — devuelve un map { leadId → ISO timestamp } con
// la última acción saliente (Llamada o WhatsApp_Saliente) registrada
// por lead. Lo consume ActuarHoyView para detectar 'caliente sin
// acción >12h' con timestamp real (antes era una aproximación binaria
// con whatsappEnviados==0 + !llamado, que no capturaba el caso 'envié
// hace 5 días → sigue siendo ALTO').
//
// Implementación: 1 query a Acciones_Lead filtrada a las 2 acciones
// salientes que cuentan, agregamos en JS por leadId conservando el
// timestamp más reciente.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { base, TABLES, fetchAll } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const recs = await fetchAll(
    base(TABLES.accionesLead as any).select({
      filterByFormula: `OR({Tipo_Accion}='Llamada', {Tipo_Accion}='WhatsApp_Saliente')`,
      fields: ["Lead", "Timestamp"],
    }),
  );
  const map: Record<string, string> = {};
  for (const r of recs) {
    const f = r.fields as any;
    const links = (f["Lead"] ?? []) as string[];
    const lid = links[0];
    if (!lid) continue;
    const ts = String(
      f["Timestamp"] ?? r._rawJson?.createdTime ?? r.createdTime ?? "",
    );
    if (!ts) continue;
    const prev = map[lid];
    if (!prev || ts > prev) map[lid] = ts;
  }
  return NextResponse.json({ ultimaSalientePorLead: map });
});
