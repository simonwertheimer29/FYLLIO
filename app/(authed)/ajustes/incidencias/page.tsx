// app/(authed)/ajustes/incidencias/page.tsx
// Los fallos capturados, en nuestra base, agrupados y sin contenido (MEJORAS 207).

import { IncidenciasView } from "./IncidenciasView";

export const dynamic = "force-dynamic";

export default function AjustesIncidenciasPage() {
  return <IncidenciasView />;
}
