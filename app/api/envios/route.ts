// app/api/envios/route.ts
// GET — todo lo que pinta la pantalla de la cola de envíos (B6.4). La lógica
// vive en lib/envios/vista-envios; aquí solo la sesión y su scope de clínicas
// por IDs (fail-closed: sin clinicasAccesibles no se ve nada).

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { vistaEnvios } from "../../lib/envios/vista-envios";

export const GET = withPresupuestosAuth(async (session) => {
  try {
    const acc = session.clinicasAccesibles;
    const idsPermitidas = acc && acc.includes("*") ? null : new Set(acc ?? []);
    const vista = await vistaEnvios({ clinicaIdsPermitidas: idsPermitidas });
    return NextResponse.json(vista);
  } catch (err) {
    console.error("[envios] GET error:", err);
    return NextResponse.json({ error: "No se pudo cargar la cola de envíos" }, { status: 500 });
  }
});
