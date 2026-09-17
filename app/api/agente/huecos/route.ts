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
import { runWithClienteDb } from "../../../lib/db/context";
import { sql } from "kysely";
import { hoyISO, horaClinica } from "../../../lib/time";

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
      // ?pendiente=1 — la cita YA está reservada (o se acaba de mover) y no se
      // ha confirmado al paciente: solo el texto exacto que saldría, para que
      // la coordinadora lo vea antes de pulsar.
      if (url.searchParams.get("pendiente") === "1") {
        const fila: any = await runWithClienteDb(session.cliente!, (trx) =>
          sql`select c.hora_inicio, c.confirmada_en, s.nombre as doctor, cl.nombre as clinica
              from citas c
              left join staff s on s.cliente = c.cliente and s.id = c.profesional_id
              left join clinicas cl on cl.cliente = c.cliente and cl.id = c.clinica_id
             where c.lead_id = ${ficha.lead!.id} and c.hora_inicio >= now() and c.estado in ('Programada', 'Confirmada')
             order by c.hora_inicio asc limit 1`.execute(trx),
        );
        const c = fila.rows?.[0] ?? null;
        if (!c) return NextResponse.json({ pendiente: null });
        if (c.confirmada_en) return NextResponse.json({ pendiente: null, confirmadaEnISO: new Date(c.confirmada_en).toISOString() });
        const d = new Date(c.hora_inicio);
        return NextResponse.json({
          pendiente: {
            texto: textoConfirmacionCita({ nombre: ficha.lead!.nombre, fecha: hoyISO(d), hora: horaClinica(d), doctor: c.doctor ?? null, clinica: c.clinica ?? null }),
          },
          agendaEnFyllio: ficha.agendaEnFyllio,
        });
      }
      const tratamientoTexto =
        ficha.recogido?.find((c) => c.campo === "tratamiento_o_molestia")?.valor ?? null;
      // `doctorId=todos` quita el filtro del doctor asignado (la coordinadora
      // decide); sin parámetro, el asignado del lead si lo tiene.
      const doctorId = doctorParam === "todos" ? null : doctorParam || ficha.lead.doctorAsignadoId || null;
      // 060 — `todos=1[&desde=YYYY-MM-DD][&dias=7]`: la agenda entera en
      // orden de fecha (sin escalera), para que la coordinadora AÑADA horas a
      // la propuesta más allá de las tres que cumplen la preferencia.
      const todos = url.searchParams.get("todos") === "1";
      const desde = url.searchParams.get("desde");
      const dias = Number(url.searchParams.get("dias") ?? "");
      const r = await huecosDelCaso({
        preferencia: ficha.preferenciaCita,
        tratamientoTexto,
        tratamientoId,
        doctorId,
        clinicaId: ficha.clinicaId,
        ...(todos
          ? { modo: "todos" as const, desde: desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : undefined, dias: Number.isFinite(dias) && dias > 0 ? Math.min(dias, 14) : 7 }
          : {}),
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
