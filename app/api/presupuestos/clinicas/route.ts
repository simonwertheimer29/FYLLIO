// app/api/presupuestos/clinicas/route.ts
// GET: lista de clínicas (solo manager_general)

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

const DEMO_CLINICAS = ["Clínica Madrid Centro", "Clínica Salamanca"];

export const GET = withPresupuestosAuth(async (session) => {
  if (session.rol !== "manager_general") {
    return NextResponse.json({ clinicas: session.clinica ? [session.clinica] : [] });
  }

  // Fase 4 — devolver las clínicas del cliente desde el registro central por cliente.
  return NextResponse.json({ clinicas: DEMO_CLINICAS, isDemo: true });
});
