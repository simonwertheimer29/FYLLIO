// app/api/agenda/citas/[id]/route.ts
//
// AGENDA G2/G2.4 — dos operaciones sobre UNA cita:
//
//   · {trasladada}: la marca «pasada al software clínico» (nivel 1 es un
//     registro de traspaso). Reversible — nada desaparece sin vuelta atrás.
//   · {fecha, hora, doctorId?, tratamientoId?}: MOVER/REAGENDAR. Dos reglas
//     duras dictadas: solo se mueve lo origen_sistema='fyllio' («la cita que
//     se mueve la creamos nosotros» — una importada se cambia en el software
//     de la clínica, aquí ni se intenta), y si la cita nació de un lead se
//     SINCRONIZA su copia (leads.fecha_cita/hora_cita/doctor) — sin esto el
//     kanban enseñaría la hora vieja. Mover resetea la marca de traslado
//     (hay que volver a pasarla) y devuelve el estado a Programada (el
//     paciente confirmó la HORA VIEJA, no esta).
//
// Coordinación solo sobre citas de SUS clínicas.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { runWithCliente } from "../../../../lib/airtable";
import { runWithClienteDb } from "../../../../lib/db/context";
import { actualizarUna } from "../../../../lib/db/escritura";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { instanteDeCita } from "../../../../lib/agenda/cita-de-lead";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400 });
  const esTraslado = typeof body.trasladada === "boolean";
  const esMovimiento = typeof body.fecha === "string" || typeof body.hora === "string";
  if (!esTraslado && !esMovimiento) {
    return NextResponse.json({ error: "Falta trasladada o fecha+hora" }, { status: 400 });
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      return runWithClienteDb(session.cliente!, async (trx) => {
        const cita = await trx
          .selectFrom("citas")
          .select(["id", "clinica_id", "origen_sistema", "lead_id", "tratamiento_id"])
          .where("id", "=", id)
          .executeTakeFirst();
        if (!cita) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
        if (session.rol !== "admin") {
          const allowed = await listClinicaIdsForUser(session.userId);
          // Fail-closed: una cita sin clínica no es de «todas» — no se toca.
          if (!cita.clinica_id || !allowed.includes(cita.clinica_id)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
          }
        }

        if (esTraslado) {
          await actualizarUna(
            trx.updateTable("citas").set({ trasladada_en: body.trasladada ? new Date() : null }).where("id", "=", id),
            "citas", id,
          );
          return NextResponse.json({ ok: true });
        }

        // ── MOVER / REAGENDAR ────────────────────────────────────────────
        if (cita.origen_sistema !== "fyllio") {
          return NextResponse.json(
            { error: "Esta cita vive en tu software clínico — muévela allí. Aquí solo se mueven las creadas en Fyllio." },
            { status: 422 },
          );
        }
        const inicio = instanteDeCita(String(body.fecha ?? ""), String(body.hora ?? ""));
        if (!inicio) return NextResponse.json({ error: "Fecha u hora ilegibles." }, { status: 422 });

        const doctorId = typeof body.doctorId === "string" && body.doctorId ? body.doctorId : null;
        let clinicaNueva: string | null = null;
        if (doctorId) {
          const doctor = await trx.selectFrom("staff").select(["id", "clinica_id"]).where("id", "=", doctorId).executeTakeFirst();
          if (!doctor) return NextResponse.json({ error: "Doctor desconocido." }, { status: 422 });
          if (session.rol !== "admin") {
            const allowed = await listClinicaIdsForUser(session.userId);
            if (!doctor.clinica_id || !allowed.includes(doctor.clinica_id)) {
              return NextResponse.json({ error: "No autorizado" }, { status: 403 });
            }
          }
          clinicaNueva = doctor.clinica_id ?? null;
        }

        // tratamientoId explícito manda; si no, el de la cita — y la duración
        // se RECALCULA del catálogo (mover no hereda un fin desfasado).
        const tratamientoId =
          typeof body.tratamientoId === "string"
            ? (body.tratamientoId || null)
            : (cita.tratamiento_id ?? null);
        let fin: Date | null = null;
        if (tratamientoId) {
          const t = await trx.selectFrom("tratamientos").select(["id", "duracion_min"]).where("id", "=", tratamientoId).executeTakeFirst();
          if (!t) return NextResponse.json({ error: "Tratamiento desconocido." }, { status: 422 });
          if (t.duracion_min != null && t.duracion_min > 0) fin = new Date(inicio.getTime() + t.duracion_min * 60000);
        }

        await actualizarUna(
          trx.updateTable("citas").set({
            hora_inicio: inicio,
            hora_final: fin,
            tratamiento_id: tratamientoId,
            ...(doctorId ? { profesional_id: doctorId, clinica_id: clinicaNueva } : {}),
            estado: "Programada",
            agendada_en: new Date(),
            trasladada_en: null,
          } as any).where("id", "=", id),
          "citas", id,
        );

        // La copia del lead, EN LA MISMA transacción: el kanban no puede
        // quedarse enseñando la hora vieja.
        if (cita.lead_id) {
          await trx.updateTable("leads").set({
            fecha_cita: String(body.fecha),
            hora_cita: String(body.hora),
            ...(doctorId ? { doctor_asignado_id: doctorId } : {}),
          } as any).where("id", "=", cita.lead_id).execute();
        }
        return NextResponse.json({ ok: true });
      });
    });
  } catch (err) {
    // §1 — si no se guardó, no se confirma.
    console.error("[agenda/citas] PATCH:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
});
