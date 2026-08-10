// app/(authed)/informes/page.tsx
//
// El informe mensual, en su propia pantalla (MEJORAS 81).
//
// Vivía dentro de un cajón lateral de /kpis, y era un cajón que contenía OTRA
// pantalla: filtros propios de mes y clínica, dos pestañas internas, un
// historial de informes guardados y gráficas que se capturan a PNG para el PDF.
// El patrón del producto es «las tarjetas informan, los paneles actúan», y esto
// no es una acción de un clic: se genera un documento y después se navega el
// historial.
//
// Y había una razón técnica además de la de coherencia: la captura con
// `dom-to-image-more` necesita los nodos montados, y **un cajón que se desmonta
// al cerrarse es mal anfitrión para eso**.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import type { UserSession } from "../../lib/presupuestos/types";
import { InformesCliente } from "./InformesCliente";

export const dynamic = "force-dynamic";

export default async function InformesPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };

  return <InformesCliente user={user} />;
}
