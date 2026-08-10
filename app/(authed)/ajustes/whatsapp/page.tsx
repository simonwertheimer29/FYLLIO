// app/(authed)/ajustes/whatsapp/page.tsx
// Conexión de WhatsApp y su estado. Movido de /automatizaciones (MEJORAS 13).

import { userDeAjustes } from "../sesion";
import { SectionWhatsApp } from "../../../components/ajustes/PanelesConfiguracion";

export const dynamic = "force-dynamic";

export default async function AjustesWhatsAppPage() {
  const user = await userDeAjustes();
  return <SectionWhatsApp user={user} />;
}
