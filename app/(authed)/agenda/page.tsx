// app/(authed)/agenda/page.tsx
// AGENDA G2 — la ventana de agenda (nivel 1). Server component mínimo: los
// datos los carga el client de /api/agenda/semana (ya scopeada por sesión).

import { AgendaView } from "./AgendaView";

export const dynamic = "force-dynamic";

export default function AgendaPage() {
  return <AgendaView />;
}
