// app/lib/agente/acceso-hilo-sesion.ts
//
// La regla de acceso a UN hilo desde una sesión (MEJORAS 122), en un sitio:
// admin ve la red; cualquier otro rol, solo hilos de sus clínicas. Las
// clínicas del hilo son las de sus mensajes; sin ninguna, la de la ficha
// desempata; sin ninguna, solo la red. Fail-closed (§3).
//
// La usan /api/agente/ficha, /api/agente/por-que y /api/agente/candidatos:
// un filtro copiado tres veces es tres sitios donde olvidarse de una regla.
// Llamar DENTRO de runWithCliente (lee la base del cliente).

import type { Session } from "../auth/session";
import { listClinicaIdsForUser } from "../auth/users";
import { contextoDeConversacion } from "./contexto-conversacion";
import { clinicasDelHilo, puedeVerHilo } from "../mensajeria/acceso-hilo";

export async function puedeVerHiloSesion(session: Session, telefono: string): Promise<boolean> {
  if (session.rol === "admin") return true;
  const permitidas = await listClinicaIdsForUser(session.userId);
  const ctx = await contextoDeConversacion(telefono);
  const { todas } = await clinicasDelHilo(telefono);
  const cls = todas.length ? todas : ctx.clinicaId ? [String(ctx.clinicaId)] : [];
  return puedeVerHilo(permitidas, cls);
}
