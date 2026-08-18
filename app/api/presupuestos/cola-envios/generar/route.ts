// app/api/presupuestos/cola-envios/generar/route.ts
// POST — el paso diario de la cola de envíos, disparado a mano desde la
// pantalla. La LÓGICA vive en lib/envios/generar-envios-del-dia (B6.3):
// caducar lo pendiente de días anteriores + generar con datos de hoy
// (presupuestos + recordatorios de cita). Esta ruta solo aporta la sesión y
// su scope; el cron diario invoca la misma lib con scope null.

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas } from "../../../../lib/presupuestos/clinica-scope";
import { generarEnviosDelDia } from "../../../../lib/envios/generar-envios-del-dia";

export const POST = withPresupuestosAuth(async (session) => {
  try {
    const permitidas = await nombresClinicasPermitidas(session);
    // El generador de citas scopea por IDs (los datos de citas guardan
    // clinica_id); mismo criterio fail-closed que los nombres: "*" = null.
    const acc = session.clinicasAccesibles;
    const idsPermitidas = acc && acc.includes("*") ? null : new Set(acc ?? []);
    const resultado = await generarEnviosDelDia({
      clinicasPermitidas: permitidas,
      clinicaIdsPermitidas: idsPermitidas,
    });
    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[cola-envios/generar] Error:", err);
    return NextResponse.json({ error: "Error al generar cola" }, { status: 500 });
  }
});
