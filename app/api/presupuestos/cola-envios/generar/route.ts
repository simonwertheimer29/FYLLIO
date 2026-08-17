// app/api/presupuestos/cola-envios/generar/route.ts
// POST — genera la cola de envíos del día. La LÓGICA vive en
// lib/presupuestos/generar-cola (extraída en fase B, 2026-08-17): esta ruta
// solo aporta la sesión y su scope de clínicas. Así la misma generación la
// pueden invocar un cron (scope null) y el QA de recorridos (con `hoy`
// inyectado) — que era imposible mientras vivía dentro del withAuth.

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas } from "../../../../lib/presupuestos/clinica-scope";
import { generarColaDelDia } from "../../../../lib/presupuestos/generar-cola";

export const POST = withPresupuestosAuth(async (session) => {
  try {
    const permitidas = await nombresClinicasPermitidas(session);
    const resultado = await generarColaDelDia({ clinicasPermitidas: permitidas });
    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[cola-envios/generar] Error:", err);
    return NextResponse.json({ error: "Error al generar cola" }, { status: 500 });
  }
});
