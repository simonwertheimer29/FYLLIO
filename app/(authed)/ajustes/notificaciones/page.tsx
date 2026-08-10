// app/(authed)/ajustes/notificaciones/page.tsx
// Avisos del navegador. Movido de /automatizaciones (MEJORAS 13).

import { SectionNotificaciones } from "../../../components/ajustes/PanelesConfiguracion";

export const dynamic = "force-dynamic";

export default function AjustesNotificacionesPage() {
  return <SectionNotificaciones />;
}
