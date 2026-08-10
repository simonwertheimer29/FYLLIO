// app/(authed)/ajustes/sesion.ts
//
// La forma `UserSession` que esperan los paneles movidos desde
// /automatizaciones. El layout de /ajustes ya ha comprobado sesión y rol admin,
// así que aquí solo se traduce — la puerta está una sola vez, arriba.

import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";

export async function userDeAjustes(): Promise<UserSession> {
  const s = await getSession();
  return {
    email: "",
    nombre: s?.nombre ?? "",
    rol: s?.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };
}
