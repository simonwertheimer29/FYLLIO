// Helper compartido de las rutas /api/cobros/[pacienteId]/* — resuelve el
// paciente y verifica que su clínica está en el scope del usuario (admin sin
// restricción; coordinación acotada a sus clínicas). Fail-closed: paciente
// sin clínica = forbidden para roles restringidos.
// (No es un route file: Next solo trata route.ts como endpoint.)

import { NextResponse } from "next/server";
import type { Session } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { getPaciente, type Paciente } from "../../../lib/pacientes/pacientes";

export async function pacienteEnScope(
  session: Pick<Session, "rol" | "userId">,
  pacienteId: string,
): Promise<{ paciente: Paciente } | { error: NextResponse }> {
  const paciente = await getPaciente(pacienteId);
  if (!paciente) {
    return { error: NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 }) };
  }
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    }
  }
  return { paciente };
}
