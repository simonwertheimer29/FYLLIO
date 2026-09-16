// app/api/agente/confirmar-cita/route.ts
//
// LA CONFIRMACIÓN AL PACIENTE, AL CLIC DE LA COORDINADORA (17-09, paso 3).
// POST { telefono, leadId, texto }. La cita YA está reservada por el camino de
// siempre (PATCH /api/leads/[id]); esto la confirma. La lógica y sus reglas
// viven en lib/agenda/confirmar-cita.ts (el QA de DEMO recorre lo mismo);
// aquí solo el acceso (puedeVerHiloSesion) y la traducción a HTTP.
import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { puedeVerHiloSesion } from "../../../lib/agente/acceso-hilo-sesion";
import { confirmarCitaAlPaciente, MENSAJE_MOTIVO } from "../../../lib/agenda/confirmar-cita";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { lead_no_existe: 404, fallo_envio: 502 };

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const telefono = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  const texto = typeof body?.texto === "string" ? body.texto : "";
  if (!telefono || !leadId || !texto) return NextResponse.json({ error: "Faltan telefono, leadId o texto" }, { status: 400 });

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      const r = await confirmarCitaAlPaciente({ telefono, leadId, texto });
      if (!r.ok) {
        return NextResponse.json({ error: MENSAJE_MOTIVO[r.motivo], motivo: r.motivo, esperado: r.esperado ?? null }, { status: STATUS[r.motivo] ?? 409 });
      }
      return NextResponse.json(r);
    });
  } catch (err) {
    console.error("[agente/confirmar-cita]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo confirmar la cita" }, { status: 500 });
  }
});
