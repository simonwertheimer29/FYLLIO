// app/api/agente/huecos/route.ts
//
// LOS HUECOS PARA UN CASO (17-09, paso 3 de la ficha). GET ?telefono=…
// [&tratamientoId=…][&doctorId=…|todos]. Compone la ficha (la preferencia que
// recogió el agente, el tratamiento que dijo la persona, el lead con su
// doctor) y devuelve tres huecos con su GARANTÍA (lib/agenda/garantia.ts) y
// el texto exacto de confirmación de cada uno, para que la coordinadora lo
// vea ANTES de pulsar. Mismo acceso que la ficha (puedeVerHiloSesion).
import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { fichaDeCaso } from "../../../lib/agente/ficha-caso";
import { puedeVerHiloSesion } from "../../../lib/agente/acceso-hilo-sesion";
import { huecosDelCaso } from "../../../lib/agenda/huecos-del-caso";
import { textoConfirmacionCita } from "../../../lib/agenda/confirmacion-cita";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const telefono = (url.searchParams.get("telefono") ?? "").trim();
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  }
  const tratamientoId = url.searchParams.get("tratamientoId") || null;
  const doctorParam = url.searchParams.get("doctorId");

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      const ficha = await fichaDeCaso(telefono);
      if (!ficha.lead) {
        return NextResponse.json({ error: "Este caso no tiene un lead abierto: la cita se agenda desde la agenda." }, { status: 409 });
      }
      const tratamientoTexto =
        ficha.recogido?.find((c) => c.campo === "tratamiento_o_molestia")?.valor ?? null;
      // `doctorId=todos` quita el filtro del doctor asignado (la coordinadora
      // decide); sin parámetro, el asignado del lead si lo tiene.
      const doctorId = doctorParam === "todos" ? null : doctorParam || ficha.lead.doctorAsignadoId || null;
      const r = await huecosDelCaso({
        preferencia: ficha.preferenciaCita,
        tratamientoTexto,
        tratamientoId,
        doctorId,
      });
      return NextResponse.json({
        ...r,
        lead: ficha.lead,
        huecos: r.huecos.map((h) => ({
          ...h,
          textoConfirmacion: textoConfirmacionCita({
            nombre: ficha.lead!.nombre,
            fecha: h.fecha,
            hora: h.hora,
            doctor: h.doctorNombre || null,
            clinica: h.clinicaNombre,
          }),
        })),
      });
    });
  } catch (err) {
    console.error("[agente/huecos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudieron calcular los huecos" }, { status: 500 });
  }
});
