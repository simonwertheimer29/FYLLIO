// app/api/agenda/semana/route.ts
//
// AGENDA G2 — los datos de la ventana /agenda para una semana: por día y por
// doctor, sus franjas, bloqueos, citas y huecos LIBRES (el motor de G1c), más
// la lista de «cerradas en Fyllio, pendientes de pasar a tu software».
//
// NIVEL 1, y la regla que lo gobierna: lo que se enseña como libre solo es
// libre EN LO QUE FYLLIO CONOCE — la ventana lo dice con un aviso fijo. Y si
// un día tiene una cita sin hora final (duración desconocida), los huecos de
// ese doctor ese día NO se afirman: `libres: null` con motivo, jamás un hueco
// calculado sobre una ocupación que no sabemos medir (§4).
//
// Scoping: vista para todos los roles; coordinación solo ve doctores y citas
// de SUS clínicas (clinicasNegocioAccesibles, fail-closed).

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { clinicasNegocioAccesibles } from "../../../lib/clinicas-negocio";
import { inicioDelDiaUTC, sumaDias, hoyISO, horaClinica } from "../../../lib/time";
import {
  aMin,
  franjasDelDia,
  disponibilidadDia,
  proyectarAlDia,
  type IntervaloMin,
} from "../../../lib/agenda/disponibilidad";

export const dynamic = "force-dynamic";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde") ?? hoyISO();
  if (!RE_FECHA.test(desde)) return NextResponse.json({ error: "desde no es YYYY-MM-DD" }, { status: 400 });
  const fechas = Array.from({ length: 7 }, (_, i) => (i === 0 ? desde : sumaDias(desde, i)));
  const desdeUTC = inicioDelDiaUTC(desde);
  const hastaUTC = inicioDelDiaUTC(sumaDias(desde, 7));

  try {
    return await runWithCliente(session.cliente, async () => {
      const scope = await clinicasNegocioAccesibles(session);
      const d = await runWithClienteDb(session.cliente!, async (trx) => {
        const staff = await trx
          .selectFrom("staff")
          .leftJoin("clinicas", (j) => j.onRef("clinicas.id", "=", "staff.clinica_id"))
          .select(["staff.id", "staff.nombre", "staff.rol", "staff.activo", "staff.clinica_id", "clinicas.nombre as clinica_nombre"])
          .orderBy("staff.nombre", "asc")
          .execute();
        const especialidades = await trx.selectFrom("especialidades").select(["id", "nombre", "activa"]).orderBy("nombre").execute();
        const asignaciones = await trx.selectFrom("staff_especialidades").select(["staff_id", "especialidad_id"]).execute();
        const horarios = await trx.selectFrom("horarios_staff").select(["staff_id", "dia_semana", "inicio", "fin"]).execute();
        // G2.4 — el catálogo para el modal de crear/mover (la duración real).
        const catalogoTratamientos = await trx
          .selectFrom("tratamientos")
          .select(["id", "nombre", "duracion_min", "clinica_id"])
          .orderBy("nombre", "asc")
          .execute();
        const bloqueos = await trx
          .selectFrom("bloqueos_staff")
          .select(["staff_id", "inicio", "fin", "motivo"])
          .where("fin", ">", desdeUTC)
          .where("inicio", "<", hastaUTC)
          .execute();
        const citas = await trx
          .selectFrom("citas")
          .leftJoin("tratamientos", (j) => j.onRef("tratamientos.id", "=", "citas.tratamiento_id"))
          .select([
            "citas.id", "citas.nombre", "citas.hora_inicio", "citas.hora_final", "citas.estado",
            "citas.profesional_id", "citas.clinica_id", "citas.origen_sistema", "citas.lead_id",
            "citas.trasladada_en", "citas.tratamiento_id",
            "tratamientos.nombre as tratamiento_nombre",
          ])
          .where("citas.hora_inicio", ">=", desdeUTC)
          .where("citas.hora_inicio", "<", hastaUTC)
          .where("citas.estado", "in", ["Programada", "Confirmada", "Completado"])
          .execute();
        // Pendientes de pasar al software: origen fyllio, sin marca, de los
        // últimos 7 días hacia adelante (no solo esta semana — la lista es de
        // TRABAJO, no del rango visible).
        const pendientes: any = await sql`
          select c.id, c.nombre, c.hora_inicio, c.estado, c.lead_id,
                 s.nombre as doctor_nombre, cl.nombre as clinica_nombre, c.clinica_id,
                 coalesce(p.telefono, l.telefono) as telefono
            from citas c
            left join staff s on s.cliente = c.cliente and s.id = c.profesional_id
            left join clinicas cl on cl.cliente = c.cliente and cl.id = c.clinica_id
            left join pacientes p on p.cliente = c.cliente and p.id = c.paciente_id
            left join leads l on l.cliente = c.cliente and l.id = c.lead_id
           where c.origen_sistema = 'fyllio'
             and c.trasladada_en is null
             and c.estado in ('Programada', 'Confirmada')
             and c.hora_inicio >= now() - interval '7 days'
           order by c.hora_inicio asc
           limit 100`.execute(trx);
        return { staff, especialidades, asignaciones, horarios, bloqueos, citas, catalogoTratamientos, pendientes: pendientes.rows ?? [] };
      });

      // ── Scoping fail-closed: coordinación solo SUS clínicas ─────────────
      const enScope = (clinicaId: string | null) =>
        scope.ids === null ? true : clinicaId !== null && scope.ids.includes(clinicaId);
      const doctores = d.staff.filter((s: any) => (s.rol ?? "") === "Dentista" && s.activo !== false && enScope(s.clinica_id));
      const doctorIds = new Set(doctores.map((s: any) => s.id));
      const citas = d.citas.filter((c: any) => enScope(c.clinica_id));
      const pendientes = d.pendientes.filter((p: any) => enScope(p.clinica_id));

      // ── Composición por día y doctor (el motor puro de G1c) ─────────────
      const horariosPorDoctor = new Map<string, Array<{ dia_semana: number; inicio: string; fin: string }>>();
      for (const h of d.horarios) {
        if (!doctorIds.has(h.staff_id)) continue;
        const lista = horariosPorDoctor.get(h.staff_id) ?? [];
        lista.push({ dia_semana: h.dia_semana, inicio: h.inicio, fin: h.fin });
        horariosPorDoctor.set(h.staff_id, lista);
      }

      const dias = fechas.map((fecha) => {
        const porDoctor = doctores.map((doc: any) => {
          const franjas = franjasDelDia(horariosPorDoctor.get(doc.id) ?? [], fecha);
          const bloqueosDia: Array<IntervaloMin & { motivo: string | null }> = [];
          for (const b of d.bloqueos) {
            if (b.staff_id !== doc.id) continue;
            const p = proyectarAlDia({ inicio: new Date(b.inicio as any), fin: new Date(b.fin as any) }, fecha);
            if (p) bloqueosDia.push({ ...p, motivo: (b as any).motivo ?? null });
          }
          const citasDia: Array<{ id: string; inicioMin: number; finMin: number | null; nombre: string | null; estado: string; tratamiento: string | null; tratamientoId: string | null; deLead: boolean; sinPasar: boolean; esFyllio: boolean }> = [];
          let sinDuracion = false;
          for (const c of citas) {
            if (c.profesional_id !== doc.id || !c.hora_inicio) continue;
            const ini = new Date(c.hora_inicio as any);
            if (hoyISO(ini) !== fecha) continue;
            const inicioMin = aMin(horaClinica(ini));
            let finMin: number | null = null;
            if (c.hora_final) {
              const p = proyectarAlDia({ inicio: ini, fin: new Date(c.hora_final as any) }, fecha);
              finMin = p?.fin ?? null;
            }
            if (finMin === null) sinDuracion = true;
            citasDia.push({
              id: c.id, inicioMin, finMin, nombre: c.nombre ?? null, estado: String(c.estado),
              tratamiento: (c as any).tratamiento_nombre ?? null, tratamientoId: c.tratamiento_id ?? null,
              deLead: c.lead_id !== null,
              // G2.2 — nacida en Fyllio y aún sin pasar al software: el
              // resumen plegado lo cuenta donde se escanea.
              sinPasar: c.origen_sistema === "fyllio" && c.trasladada_en === null,
              // G2.4 — solo lo nacido en Fyllio se puede mover desde aquí.
              esFyllio: c.origen_sistema === "fyllio",
            });
          }
          citasDia.sort((a, b) => a.inicioMin - b.inicioMin);
          // Huecos: solo si TODAS las ocupaciones del día se pueden medir.
          const libres = sinDuracion
            ? null
            : disponibilidadDia({
                franjas,
                ocupaciones: [
                  ...bloqueosDia.map(({ inicio, fin }) => ({ inicio, fin })),
                  ...citasDia.map((c) => ({ inicio: c.inicioMin, fin: c.finMin! })),
                ],
              });
          return { staffId: doc.id, franjas, bloqueos: bloqueosDia, citas: citasDia, libres };
        });
        return { fecha, porDoctor };
      });

      return NextResponse.json({
        desde,
        doctores: doctores.map((s: any) => ({
          id: s.id, nombre: s.nombre ?? "", clinicaId: s.clinica_id ?? null, clinicaNombre: s.clinica_nombre ?? null,
          especialidadIds: d.asignaciones.filter((a: any) => a.staff_id === s.id).map((a: any) => a.especialidad_id),
          sinHorario: (horariosPorDoctor.get(s.id) ?? []).length === 0,
        })),
        especialidades: d.especialidades
          .filter((e: any) => e.activa === true)
          .map((e: any) => ({ id: e.id, nombre: e.nombre })),
        dias,
        tratamientos: d.catalogoTratamientos.map((t: any) => ({
          id: t.id, nombre: t.nombre ?? "", duracionMin: t.duracion_min ?? null, clinicaId: t.clinica_id ?? null,
        })),
        pendientes: pendientes.map((p: any) => ({
          id: p.id,
          nombre: p.nombre ?? null,
          fecha: p.hora_inicio ? hoyISO(new Date(p.hora_inicio)) : null,
          hora: p.hora_inicio ? horaClinica(new Date(p.hora_inicio)) : null,
          estado: String(p.estado),
          doctorNombre: p.doctor_nombre ?? null,
          clinicaNombre: p.clinica_nombre ?? null,
          telefono: p.telefono ?? null,
        })),
      });
    });
  } catch (err) {
    console.error("[agenda/semana] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo cargar la agenda" }, { status: 500 });
  }
});
