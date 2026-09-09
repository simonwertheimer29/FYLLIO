// app/(authed)/analiticas/fuga/page.tsx
// Dónde se pierde: el mapa de fuga por etapa, en € y con el porqué (2.2, MEJORAS 177).

import { FugaView } from "./FugaView";

export const dynamic = "force-dynamic";

export default function FugaPage() {
  return <FugaView />;
}
