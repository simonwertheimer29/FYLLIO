// app/api/automatizaciones/seed-demo/route.ts
// POST — Inserta 3 secuencias de demo en estado "pendiente".
// Solo admin / manager_general.

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

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

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

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
}
