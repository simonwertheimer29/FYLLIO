// app/(authed)/analiticas/conversacion/page.tsx
// Qué dicen: lo que los pacientes le dicen al agente, agregado (2.1, MEJORAS 176).

import { ConversacionView } from "./ConversacionView";

export const dynamic = "force-dynamic";

export default function ConversacionPage() {
  return <ConversacionView />;
}
