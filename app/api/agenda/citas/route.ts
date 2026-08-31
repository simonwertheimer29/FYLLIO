// app/api/agenda/citas/route.ts
//
// AGENDA G2.4 — crear una cita desde la rejilla. Nace 'fyllio' (y por tanto
// entra sola en «pendientes de pasar a tu software»: el traspaso es manual en
// todos los niveles). La clínica es LA DEL DOCTOR — una cita no puede quedar
// colgada de otra clínica que la de quien atiende.
//
// El paciente es opcional: vinculado si se eligió de la búsqueda; sin ficha,
// la cita existe igual con el nombre tal cual (pero sin ficha no hay
// recordatorios — el modal lo dice, aquí solo se persiste la verdad).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { instanteDeCita } from "../../../lib/agenda/cita-de-lead";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400 });

  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  const fecha = typeof body.fecha === "string" ? body.fecha : "";
  const hora = typeof body.hora === "string" ? body.hora : "";
  const doctorId = typeof body.doctorId === "string" && body.doctorId ? body.doctorId : null;
  const tratamientoId = typeof body.tratamientoId === "string" && body.tratamientoId ? body.tratamientoId : null;
  // G2.7 — duración EXPLÍCITA (el bloque dibujado/estirado en la rejilla):
  // manda sobre la del catálogo.
  const duracionMin = Number.isInteger(body.duracionMin) && body.duracionMin >= 5 && body.duracionMin <= 480
    ? (body.duracionMin as number) : null;
  const pacienteId = typeof body.pacienteId === "string" && body.pacienteId ? body.pacienteId : null;
  const notas = typeof body.notas === "string" && body.notas.trim() ? body.notas.trim().slice(0, 500) : null;

  if (!nombre) return NextResponse.json({ error: "Falta el nombre del paciente." }, { status: 422 });
  if (!doctorId) return NextResponse.json({ error: "Falta el doctor." }, { status: 422 });
  const inicio = instanteDeCita(fecha, hora);
  if (!inicio) return NextResponse.json({ error: "Fecha u hora ilegibles." }, { status: 422 });

  try {
    return await runWithCliente(session.cliente, async () => {
      return runWithClienteDb(session.cliente!, async (trx) => {
        const doctor = await trx.selectFrom("staff").select(["id", "clinica_id"]).where("id", "=", doctorId).executeTakeFirst();
        if (!doctor) return NextResponse.json({ error: "Doctor desconocido." }, { status: 422 });
        // Scoping fail-closed: coordinación solo agenda en SUS clínicas.
        if (session.rol !== "admin") {
          const allowed = await listClinicaIdsForUser(session.userId);
          if (!doctor.clinica_id || !allowed.includes(doctor.clinica_id)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
          }
        }
        if (pacienteId) {
          const p = await trx.selectFrom("pacientes").select("id").where("id", "=", pacienteId).executeTakeFirst();
          if (!p) return NextResponse.json({ error: "Paciente desconocido." }, { status: 422 });
        }
        // Duración REAL del catálogo — sin fallback (dictado): sin
        // tratamiento, hora_final null y la rejilla dirá que no afirma huecos.
        let fin: Date | null = duracionMin ? new Date(inicio.getTime() + duracionMin * 60000) : null;
        if (tratamientoId) {
          const t = await trx.selectFrom("tratamientos").select(["id", "duracion_min"]).where("id", "=", tratamientoId).executeTakeFirst();
          if (!t) return NextResponse.json({ error: "Tratamiento desconocido." }, { status: 422 });
          if (!fin && t.duracion_min != null && t.duracion_min > 0) fin = new Date(inicio.getTime() + t.duracion_min * 60000);
        }
        const r = await trx
          .insertInto("citas")
          .values({
            cliente: session.cliente!,
            nombre,
            hora_inicio: inicio,
            hora_final: fin,
            estado: "Programada",
            origen: "Coordinación",
            clinica_id: doctor.clinica_id,
            profesional_id: doctor.id,
            tratamiento_id: tratamientoId,
            paciente_id: pacienteId,
            notas,
          } as any)
          .returning("id")
          .executeTakeFirstOrThrow();
        return NextResponse.json({ ok: true, id: r.id });
      });
    });
  } catch (err) {
    // §1 — si no se guardó, no se confirma.
    console.error("[agenda/citas] POST:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo crear la cita" }, { status: 500 });
  }
});
