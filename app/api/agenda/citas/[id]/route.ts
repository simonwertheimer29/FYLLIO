// app/api/agenda/citas/[id]/route.ts
//
// AGENDA G2 — marcar una cita como «pasada al software clínico» (nivel 1:
// la agenda de Fyllio no es la real; esta marca es el checklist de traslado).
// Reversible: {trasladada: false} la devuelve a la lista — nada desaparece
// sin vuelta atrás. Coordinación solo sobre citas de SUS clínicas.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { runWithCliente } from "../../../../lib/airtable";
import { runWithClienteDb } from "../../../../lib/db/context";
import { actualizarUna } from "../../../../lib/db/escritura";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.trasladada !== "boolean") {
    return NextResponse.json({ error: "Falta trasladada (boolean)" }, { status: 400 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      return runWithClienteDb(session.cliente!, async (trx) => {
        const cita = await trx.selectFrom("citas").select(["id", "clinica_id"]).where("id", "=", id).executeTakeFirst();
        if (!cita) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
        if (session.rol !== "admin") {
          const allowed = await listClinicaIdsForUser(session.userId);
          // Fail-closed: una cita sin clínica no es de «todas» — no se toca.
          if (!cita.clinica_id || !allowed.includes(cita.clinica_id)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
          }
        }
        await actualizarUna(
          trx.updateTable("citas").set({ trasladada_en: body.trasladada ? new Date() : null }).where("id", "=", id),
          "citas", id,
        );
        return NextResponse.json({ ok: true });
      });
    });
  } catch (err) {
    console.error("[agenda/citas] PATCH:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
});
