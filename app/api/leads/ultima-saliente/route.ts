// app/api/leads/ultima-saliente/route.ts
//
// Sprint 15 Bloque 7 — devuelve un map { leadId → ISO timestamp } con
// la última acción saliente (Llamada o WhatsApp_Saliente) registrada
// por lead. Lo consume ActuarHoyView para detectar 'caliente sin
// acción >12h' con timestamp real (antes era una aproximación binaria
// con whatsappEnviados==0 + !llamado, que no capturaba el caso 'envié
// hace 5 días → sigue siendo ALTO').
//
// Implementación: 1 query a Acciones_Lead con las 3 acciones que importan
// (Llamada/WhatsApp_Saliente = salientes; WhatsApp_Entrante = respuesta del
// paciente), agregamos en JS por leadId conservando el timestamp más reciente
// de cada dirección. La última entrante permite derivar el estado
// "esperando respuesta" (saliente posterior a la entrante) sin campo nuevo.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { base, TABLES, fetchAll } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const recs = await fetchAll(
    base(TABLES.accionesLead as any).select({
      filterByFormula: `OR({Tipo_Accion}='Llamada', {Tipo_Accion}='WhatsApp_Saliente', {Tipo_Accion}='WhatsApp_Entrante')`,
      fields: ["Lead", "Timestamp", "Tipo_Accion"],
    }),
  );
  const saliente: Record<string, string> = {};
  const entrante: Record<string, string> = {};
  for (const r of recs) {
    const f = r.fields as any;
    const links = (f["Lead"] ?? []) as string[];
    const lid = links[0];
    if (!lid) continue;
    const ts = String(
      f["Timestamp"] ?? r._rawJson?.createdTime ?? r.createdTime ?? "",
    );
    if (!ts) continue;
    const map = f["Tipo_Accion"] === "WhatsApp_Entrante" ? entrante : saliente;
    const prev = map[lid];
    if (!prev || ts > prev) map[lid] = ts;
  }
  return NextResponse.json({
    ultimaSalientePorLead: saliente,
    ultimaEntrantePorLead: entrante,
  });
});
