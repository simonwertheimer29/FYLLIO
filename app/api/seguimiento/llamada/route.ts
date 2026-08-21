// app/api/seguimiento/llamada/route.ts
//
// POST — registrar una llamada desde la ficha del despliegue (MEJORAS 102).
// La lógica vive en lib/seguimiento/registrar-llamada; aquí la sesión y el
// IDOR por tipo (mismo criterio que las rutas de envío de cada dominio):
// presupuesto → clínica del presupuesto; lead → clínica del lead; huérfano
// (conversacion) → clínica del hilo, y sin clínica resoluble solo red.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { registrarLlamada, type ResultadoLlamada } from "../../../lib/seguimiento/registrar-llamada";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const telefono = typeof body?.telefono === "string" ? body.telefono : "";
  const tipo = body?.tipo as "lead" | "presupuesto" | "conversacion" | undefined;
  const casoId = typeof body?.casoId === "string" ? body.casoId : "";
  const resultado = body?.resultado as ResultadoLlamada | undefined;
  const nota = typeof body?.nota === "string" ? body.nota : null;

  if (!telefono || !casoId || !tipo || !["lead", "presupuesto", "conversacion"].includes(tipo)
    || !resultado || !["no_contesta", "hablado"].includes(resultado)) {
    return NextResponse.json({ error: "Faltan datos de la llamada" }, { status: 400 });
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      // IDOR por tipo, fail-closed.
      if (session.rol !== "admin") {
        const permitidas = await listClinicaIdsForUser(session.userId);
        if (tipo === "lead") {
          const { getLead } = await import("../../../lib/leads/leads");
          const lead = await getLead(casoId);
          if (!lead || !lead.clinicaId || !permitidas.includes(lead.clinicaId)) {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        } else if (tipo === "presupuesto") {
          // La clínica del presupuesto vive por nombre en su dominio; el
          // verificador del Sprint B ya resuelve el puente.
          const { verificarPresupuestoPermitido } = await import("../../../lib/presupuestos/clinica-scope");
          const permiso = await verificarPresupuestoPermitido(
            { ...session, clinicasAccesibles: permitidas } as any,
            casoId,
          );
          if (permiso !== "ok") {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        } else {
          // Huérfano: la clínica del hilo (019); sin clínica resoluble → red.
          const { hiloDe } = await import("../../../lib/mensajeria/conversaciones");
          const mensajes = await hiloDe(telefono);
          const clinicaDelHilo = [...mensajes].reverse().find((m) => m.clinicaId)?.clinicaId ?? null;
          if (!clinicaDelHilo || !permitidas.includes(clinicaDelHilo)) {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        }
      }

      const r = await registrarLlamada({
        telefono,
        tipo,
        casoId,
        resultado,
        nota,
        actor: { id: session.userId ?? null, nombre: session.nombre ?? null },
      });
      return NextResponse.json({ ok: true, esperaHasta: r.esperaHasta });
    });
  } catch (err) {
    console.error("[seguimiento/llamada] error:", err);
    return NextResponse.json({ error: "No se pudo registrar la llamada" }, { status: 500 });
  }
});
