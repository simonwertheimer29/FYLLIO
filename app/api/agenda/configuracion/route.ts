// app/api/agenda/configuracion/route.ts
//
// AGENDA G1d — la configuración de la agenda: especialidades (y qué doctores
// atienden cada una), horarios por doctor (franjas, jornada partida),
// bloqueos, y duración/buffers por tratamiento. Todo es configuración de la
// clínica y todo varía — no hay defaults del sector (dictado 27-08), así que
// esta API no inventa ninguno: lo no configurado se devuelve vacío y la UI
// lo dice.
//
// SOLO admin, como el resto de /ajustes: la estructura de la agenda es una
// decisión de la clínica, no de una bandeja. Toda escritura valida AQUÍ con
// topes y errores legibles (422), y las escrituras por id comprueban su
// recuento de filas (§1 — actualizarUna).

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { actualizarUna } from "../../../lib/db/escritura";

export const dynamic = "force-dynamic";

const RE_HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const GET = withAuth(async (session) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      const d = await runWithClienteDb(session.cliente!, async (trx) => {
        const doctores = await trx
          .selectFrom("staff")
          .leftJoin("clinicas", (j) => j.onRef("clinicas.id", "=", "staff.clinica_id"))
          .select(["staff.id", "staff.nombre", "staff.clinica_id", "staff.rol", "staff.activo", "clinicas.nombre as clinica_nombre"])
          .orderBy("staff.nombre", "asc")
          .execute();
        const especialidades = await trx
          .selectFrom("especialidades")
          .select(["id", "nombre", "activa"])
          .orderBy("nombre", "asc")
          .execute();
        const asignaciones = await trx
          .selectFrom("staff_especialidades")
          .select(["staff_id", "especialidad_id"])
          .execute();
        const horarios = await trx
          .selectFrom("horarios_staff")
          .select(["id", "staff_id", "dia_semana", "inicio", "fin"])
          .orderBy("dia_semana", "asc")
          .orderBy("inicio", "asc")
          .execute();
        // Bloqueos: los vigentes y futuros, más los cerrados hace <30 días
        // (para poder deshacer un error reciente sin arqueología).
        const bloqueos: any = await sql`
          select id, staff_id, inicio, fin, motivo from bloqueos_staff
           where fin > now() - interval '30 days'
           order by inicio asc`.execute(trx);
        const tratamientos = await trx
          .selectFrom("tratamientos")
          .select(["id", "nombre", "duracion_min", "buffer_antes_min", "buffer_despues_min", "clinica_id"])
          .orderBy("nombre", "asc")
          .execute();
        return { doctores, especialidades, asignaciones, horarios, bloqueos: bloqueos.rows ?? [], tratamientos };
      });
      return NextResponse.json({
        doctores: d.doctores
          .filter((r: any) => (r.rol ?? "") === "Dentista" && r.activo !== false)
          .map((r: any) => ({ id: r.id, nombre: r.nombre ?? "", clinicaId: r.clinica_id ?? null, clinicaNombre: r.clinica_nombre ?? null })),
        especialidades: d.especialidades.map((e: any) => ({
          id: e.id,
          nombre: e.nombre,
          activa: e.activa === true,
          doctorIds: d.asignaciones.filter((a: any) => a.especialidad_id === e.id).map((a: any) => a.staff_id),
        })),
        horarios: d.horarios.map((h: any) => ({ id: h.id, staffId: h.staff_id, diaSemana: h.dia_semana, inicio: h.inicio, fin: h.fin })),
        bloqueos: d.bloqueos.map((b: any) => ({
          id: b.id, staffId: b.staff_id,
          inicioISO: new Date(b.inicio).toISOString(), finISO: new Date(b.fin).toISOString(),
          motivo: b.motivo ?? null,
        })),
        tratamientos: d.tratamientos.map((t: any) => ({
          id: t.id, nombre: t.nombre ?? "", clinicaId: t.clinica_id ?? null,
          duracionMin: t.duracion_min ?? null,
          bufferAntesMin: t.buffer_antes_min ?? null,
          bufferDespuesMin: t.buffer_despues_min ?? null,
        })),
      });
    });
  } catch (err) {
    console.error("[agenda/configuracion] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer la configuración de agenda" }, { status: 500 });
  }
});

// Una sección por petición, validada entera antes de tocar la base. El 422
// dice QUÉ está mal; un JSON malo jamás llega a una tabla.
export const PUT = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.seccion !== "string") {
    return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400 });
  }
  const err422 = (m: string) => NextResponse.json({ error: m }, { status: 422 });

  try {
    return await runWithCliente(session.cliente, async () => {
      const cliente = session.cliente!;
      switch (body.seccion) {
        case "especialidad_crear": {
          const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
          if (!nombre || nombre.length > 60) return err422("El nombre de la especialidad es obligatorio (máx. 60).");
          try {
            const r = await runWithClienteDb(cliente, (trx) =>
              trx.insertInto("especialidades").values({ cliente, nombre } as any).returning("id").executeTakeFirstOrThrow());
            return NextResponse.json({ ok: true, id: r.id });
          } catch (e: any) {
            if (String(e?.code) === "23505") return err422(`Ya existe una especialidad «${nombre}».`);
            throw e;
          }
        }
        case "especialidad_activa": {
          if (typeof body.id !== "string" || typeof body.activa !== "boolean") return err422("Faltan id o activa.");
          await runWithClienteDb(cliente, (trx) =>
            actualizarUna(trx.updateTable("especialidades").set({ activa: body.activa }).where("id", "=", body.id), "especialidades", body.id));
          return NextResponse.json({ ok: true });
        }
        case "especialidad_doctores": {
          const id = typeof body.id === "string" ? body.id : null;
          const doctorIds: unknown = body.doctorIds;
          if (!id || !Array.isArray(doctorIds) || doctorIds.some((x) => typeof x !== "string")) {
            return err422("Faltan id o doctorIds.");
          }
          await runWithClienteDb(cliente, async (trx) => {
            const existe = await trx.selectFrom("especialidades").select("id").where("id", "=", id).executeTakeFirst();
            if (!existe) throw new Error("no_encontrado");
            // Los ids tienen que ser doctores reales de este cliente: lo que
            // no exista NO se inserta en silencio — se rechaza entero.
            const staff = await trx.selectFrom("staff").select("id").where("id", "in", doctorIds.length ? (doctorIds as string[]) : ["∅"]).execute();
            if (staff.length !== doctorIds.length) throw new Error("doctor_desconocido");
            await trx.deleteFrom("staff_especialidades").where("especialidad_id", "=", id).execute();
            if (doctorIds.length) {
              await trx.insertInto("staff_especialidades")
                .values((doctorIds as string[]).map((staffId) => ({ cliente, staff_id: staffId, especialidad_id: id }) as any))
                .execute();
            }
          });
          return NextResponse.json({ ok: true });
        }
        case "horarios_doctor": {
          const staffId = typeof body.staffId === "string" ? body.staffId : null;
          const franjas: unknown = body.franjas;
          if (!staffId || !Array.isArray(franjas)) return err422("Faltan staffId o franjas.");
          for (const f of franjas) {
            if (!f || typeof f !== "object") return err422("Franja ilegible.");
            const { diaSemana, inicio, fin } = f as any;
            if (!Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7) return err422("diaSemana fuera de 1–7.");
            if (typeof inicio !== "string" || !RE_HHMM.test(inicio)) return err422(`Hora de inicio ilegible: «${String(inicio)}».`);
            if (typeof fin !== "string" || !RE_HHMM.test(fin)) return err422(`Hora de fin ilegible: «${String(fin)}».`);
            if (fin <= inicio) return err422(`La franja ${inicio}–${fin} termina antes de empezar.`);
          }
          // Solapes dentro del mismo día: dos franjas que se pisan son un
          // error de la persona, no algo que fusionar en silencio.
          const porDia = new Map<number, Array<{ inicio: string; fin: string }>>();
          for (const f of franjas as Array<{ diaSemana: number; inicio: string; fin: string }>) {
            const lista = porDia.get(f.diaSemana) ?? [];
            lista.push(f);
            porDia.set(f.diaSemana, lista);
          }
          for (const [dia, lista] of porDia) {
            const orden = [...lista].sort((a, b) => a.inicio.localeCompare(b.inicio));
            for (let i = 1; i < orden.length; i++) {
              if (orden[i].inicio < orden[i - 1].fin) {
                return err422(`Dos franjas se solapan el día ${dia}: ${orden[i - 1].inicio}–${orden[i - 1].fin} y ${orden[i].inicio}–${orden[i].fin}.`);
              }
            }
          }
          await runWithClienteDb(cliente, async (trx) => {
            const existe = await trx.selectFrom("staff").select("id").where("id", "=", staffId).executeTakeFirst();
            if (!existe) throw new Error("no_encontrado");
            // Reemplazo transaccional de la semana entera del doctor: o entra
            // toda la semana nueva o se queda la vieja (§1).
            await trx.deleteFrom("horarios_staff").where("staff_id", "=", staffId).execute();
            if ((franjas as any[]).length) {
              await trx.insertInto("horarios_staff")
                .values((franjas as Array<{ diaSemana: number; inicio: string; fin: string }>).map((f) => ({
                  cliente, staff_id: staffId, dia_semana: f.diaSemana, inicio: f.inicio, fin: f.fin,
                }) as any))
                .execute();
            }
          });
          return NextResponse.json({ ok: true });
        }
        case "bloqueo_crear": {
          const staffId = typeof body.staffId === "string" ? body.staffId : null;
          const inicio = typeof body.inicioISO === "string" ? new Date(body.inicioISO) : null;
          const fin = typeof body.finISO === "string" ? new Date(body.finISO) : null;
          const motivo = typeof body.motivo === "string" && body.motivo.trim() ? body.motivo.trim().slice(0, 200) : null;
          if (!staffId || !inicio || !fin || Number.isNaN(+inicio) || Number.isNaN(+fin)) return err422("Faltan doctor o fechas.");
          if (fin <= inicio) return err422("El bloqueo termina antes de empezar.");
          const r = await runWithClienteDb(cliente, async (trx) => {
            const existe = await trx.selectFrom("staff").select("id").where("id", "=", staffId).executeTakeFirst();
            if (!existe) throw new Error("no_encontrado");
            return trx.insertInto("bloqueos_staff")
              .values({ cliente, staff_id: staffId, inicio, fin, motivo } as any)
              .returning("id").executeTakeFirstOrThrow();
          });
          return NextResponse.json({ ok: true, id: r.id });
        }
        case "bloqueo_borrar": {
          if (typeof body.id !== "string") return err422("Falta id.");
          const n = await runWithClienteDb(cliente, (trx) =>
            trx.deleteFrom("bloqueos_staff").where("id", "=", body.id).executeTakeFirst());
          if (Number(n?.numDeletedRows ?? 0) !== 1) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          return NextResponse.json({ ok: true });
        }
        case "tratamiento_duracion": {
          const id = typeof body.id === "string" ? body.id : null;
          if (!id) return err422("Falta id.");
          const num = (v: unknown, min: number, max: number, campo: string): number | null | "mal" => {
            if (v === null || v === undefined) return null;
            if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) return "mal";
            return v as number;
          };
          const dur = num(body.duracionMin, 5, 480, "duración");
          const antes = num(body.bufferAntesMin, 0, 60, "buffer");
          const despues = num(body.bufferDespuesMin, 0, 60, "buffer");
          if (dur === "mal") return err422("Duración fuera de tope (5–480 min).");
          if (antes === "mal" || despues === "mal") return err422("Buffer fuera de tope (0–60 min).");
          await runWithClienteDb(cliente, (trx) =>
            actualizarUna(
              trx.updateTable("tratamientos").set({ duracion_min: dur, buffer_antes_min: antes, buffer_despues_min: despues }).where("id", "=", id),
              "tratamientos", id));
          return NextResponse.json({ ok: true });
        }
        default:
          return err422(`Sección desconocida: «${body.seccion}».`);
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "no_encontrado") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "doctor_desconocido") {
      return NextResponse.json({ error: "Algún doctor no existe en esta clínica" }, { status: 422 });
    }
    // §1 — si no se guardó, no se confirma.
    console.error("[agenda/configuracion] PUT:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
});
