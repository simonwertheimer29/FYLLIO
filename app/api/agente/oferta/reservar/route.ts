// app/api/agente/oferta/reservar/route.ts
//
// RESERVAR LO QUE ELIGIÓ EL PACIENTE, de un clic (17-09, 060). POST
// { telefono, indice? }. El servidor recomprueba que la hora siga libre: si
// sí, reserva (PATCH del lead de siempre) y confirma al paciente (plantilla
// de código); si NO, no manda nada y devuelve el mensaje corregido YA ESCRITO
// («se acaba de ocupar, te quedan estas») para que lo envíe de un clic.
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { runWithCliente } from "../../../../lib/airtable";
import { fichaDeCaso } from "../../../../lib/agente/ficha-caso";
import { puedeVerHiloSesion } from "../../../../lib/agente/acceso-hilo-sesion";
import { reservarEleccion, MENSAJE_MOTIVO_OFERTA } from "../../../../lib/agenda/ofertas";
import { MENSAJE_MOTIVO } from "../../../../lib/agenda/confirmar-cita";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const telefono = String(body?.["telefono"] ?? "").trim();
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  const indice = typeof body?.["indice"] === "number" && Number.isInteger(body["indice"]) ? (body["indice"] as number) : null;

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      const ficha = await fichaDeCaso(telefono);
      const r = await reservarEleccion({ telefono, indice, preferencia: ficha.preferenciaCita });
      if (!r.ok && r.motivo === "ocupado") {
        return NextResponse.json({ ok: false, motivo: "ocupado", ocupada: r.ocupada, restantes: r.restantes, texto: r.texto, variante: r.variante }, { status: 409 });
      }
      if (!r.ok) return NextResponse.json({ error: MENSAJE_MOTIVO_OFERTA[r.motivo] ?? r.motivo, motivo: r.motivo }, { status: 409 });
      const c = r.confirmacion;
      return NextResponse.json({
        ok: true,
        alternativa: r.alternativa,
        citaId: r.citaId,
        confirmacion: c.ok
          ? { ok: true, simulado: "simulado" in c ? c.simulado : false, yaConfirmada: "yaConfirmada" in c }
          : { ok: false, motivo: c.motivo, mensaje: MENSAJE_MOTIVO[c.motivo], texto: r.textoConfirmacion },
      });
    });
  } catch (err) {
    console.error("[agente/oferta/reservar]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo reservar" }, { status: 500 });
  }
});
