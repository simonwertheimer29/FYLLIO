// app/api/agente/entrada/route.ts
//
// POST — el borrador de entrada (B3): la presentación de quien retoma el
// caso. Mismo aislamiento que la ficha (§5): clínicas de la sesión, hilo sin
// clínica solo red, fuera de scope → 404. Errores HONESTOS por motivo: sin
// evaluación no hay borrador (409), descartado por el juez se dice con su
// frase (422), modelo/juez caídos son un 503 — jamás un texto inventado.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { contextoDeConversacion } from "../../../lib/agente/contexto-conversacion";
import { borradorDeEntrada } from "../../../lib/agente/borrador-entrada";
import { hiloDe } from "../../../lib/mensajeria/conversaciones";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const telefono = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  }

  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      const ctx = await contextoDeConversacion(telefono);
      if (clinicasPermitidas) {
        if (ctx.clinicaId == null || !clinicasPermitidas.includes(String(ctx.clinicaId))) {
          return NextResponse.json({ error: "No encontrado" }, { status: 404 });
        }
      }
      const mensajes = await hiloDe(telefono);
      const ultimoEntrante =
        [...mensajes].reverse().find((m) => m.direccion === "Entrante")?.contenido ?? null;

      const r = await borradorDeEntrada({
        telefono,
        coordinadora: session.nombre ?? "",
        ultimoMensaje: ultimoEntrante,
      });
      if (r.ok) return NextResponse.json({ borrador: r.borrador });
      if (r.motivo === "sin_evaluacion") {
        return NextResponse.json(
          { error: "El agente no ha evaluado este caso — no hay nada de lo que partir" },
          { status: 409 },
        );
      }
      if (r.motivo === "descartado") {
        const detalle = r.categoria === "repregunta_pendiente"
          ? `El borrador devolvía al paciente su propia pregunta${r.frase ? ` («${r.frase}»)` : ""} — lo pendiente se trae resuelto, no se repregunta. Escríbelo a mano.`
          : `El revisor descartó el borrador${r.frase ? `: «${r.frase}»` : ""}. Escríbelo a mano.`;
        return NextResponse.json({ error: detalle, categoria: r.categoria }, { status: 422 });
      }
      return NextResponse.json(
        { error: "No se pudo redactar ahora mismo — inténtalo en un momento o escríbelo a mano" },
        { status: 503 },
      );
    });
  } catch (err) {
    console.error("[agente/entrada]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo redactar la entrada" }, { status: 500 });
  }
});
