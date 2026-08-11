// app/(authed)/mensajeria/page.tsx
//
// Pantalla propia en el nav, no una vista de Seguimiento: si fuera una vista de
// Seguimiento seguiría siendo «la cola con otro aspecto», y la pregunta que
// responde es la contraria — no «qué hago ahora» sino «qué está pasando».
//
// El aislamiento lo resuelven las rutas de /api/mensajeria contra la SESIÓN,
// no esta página: un `?clinicaId=` en la URL es una petición, no un permiso.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { MensajeriaView } from "./MensajeriaView";

export const dynamic = "force-dynamic";

export default async function MensajeriaPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <MensajeriaView />;
}
