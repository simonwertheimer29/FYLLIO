// app/api/pacientes/buscar/route.ts
//
// Buscador de personas del modal de presupuesto (spec 2026-07-29).
//
// Devuelve DOS listas en una sola llamada, y en este orden de importancia:
//   pacientes → los que ya tienen historial en la clínica; se elige uno y el
//               presupuesto cuelga de su id.
//   leads     → SOLO si no hay ningún paciente. Son personas que existen pero
//               todavía no son pacientes porque falta marcar su asistencia. No
//               se pueden elegir: el modal las usa para enviar a resolverlo.
//
// El scope de clínicas es el mismo del resto del producto: admin ve todas las
// del cliente, coordinación solo las suyas (fail-closed, §3).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { buscarPacientes, buscarLeadsCitados } from "../../../lib/pacientes/busqueda";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ pacientes: [], leads: [], q });
  }

  const clinicaIds =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  // En paralelo, no en cadena: encadenarlas sumaba dos viajes a la base y el
  // caso lento (no hay paciente) era justo el que más espera la coordinadora.
  // Los leads solo se DEVUELVEN si no hay pacientes: son una segunda pregunta,
  // no un segundo resultado.
  const [pacientes, leadsCitados] = await Promise.all([
    buscarPacientes({ q, clinicaIds }),
    buscarLeadsCitados({ q, clinicaIds }),
  ]);
  const leads = pacientes.length > 0 ? [] : leadsCitados;

  return NextResponse.json({ pacientes, leads, q });
});
