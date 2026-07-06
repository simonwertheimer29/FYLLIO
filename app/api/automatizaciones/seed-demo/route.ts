// app/api/automatizaciones/seed-demo/route.ts
// POST — Inserta 3 secuencias de demo en estado "pendiente".
// Solo admin / manager_general.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

// Sprint B — migrado a withPresupuestosAuth para fijar el contexto de cliente.
export const dynamic = "force-dynamic";

const SEED_SECUENCIAS = [
  {
    presupuesto_id:  "demo-001",
    clinica:         "Clínica Madrid Centro",
    paciente_nombre: "Carmen López",
    telefono:        "600000001",
    tratamiento:     "Ortodoncia Invisible",
    tipo_evento:     "presupuesto_inactivo",
    estado:          "pendiente",
    mensaje_generado: "Hola Carmen, quería recordarte que tienes pendiente confirmar tu presupuesto de ortodoncia. ¿Tienes alguna duda que podamos resolver?",
    tono_usado:      "empatico",
    canal_sugerido:  "whatsapp",
  },
  {
    presupuesto_id:  "demo-002",
    clinica:         "Clínica Salamanca",
    paciente_nombre: "Marcos Ruiz",
    telefono:        "600000002",
    tratamiento:     "Implante unitario",
    tipo_evento:     "portal_visto_sin_respuesta",
    estado:          "pendiente",
    mensaje_generado: "Hola Marcos, vi que revisaste el presupuesto de implante. ¿Hay algo que te gustaría aclarar antes de decidir?",
    tono_usado:      "directo",
    canal_sugerido:  "whatsapp",
  },
  {
    presupuesto_id:  "demo-003",
    clinica:         "Clínica Madrid Centro",
    paciente_nombre: "Ana García",
    telefono:        "600000003",
    tratamiento:     "Blanqueamiento",
    tipo_evento:     "presupuesto_aceptado_notificacion",
    estado:          "pendiente",
    mensaje_generado: "",
    tono_usado:      "",
    canal_sugerido:  "interno",
  },
];

export const POST = withPresupuestosAuth(async (session) => {
  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    // Remove existing demo records first (clean state)
    const existingDemos = await base(TABLES.secuenciasAutomaticas as any)
      .select({
        filterByFormula: `OR({presupuesto_id}="demo-001",{presupuesto_id}="demo-002",{presupuesto_id}="demo-003")`,
        fields: [],
      })
      .all();

    if (existingDemos.length > 0) {
      await base(TABLES.secuenciasAutomaticas as any).destroy(existingDemos.map((r) => r.id));
    }

    // Insert seed records
    await base(TABLES.secuenciasAutomaticas as any).create(
      SEED_SECUENCIAS.map((s) => ({
        fields: { ...s, creado_en: now, actualizado_en: now },
      }))
    );

    return NextResponse.json({ ok: true, insertados: SEED_SECUENCIAS.length });
  } catch (err) {
    console.error("[seed-demo POST]", err);
    return NextResponse.json({ error: "Error al insertar datos de demo" }, { status: 500 });
  }
});
