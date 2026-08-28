// app/(authed)/ajustes/agenda/page.tsx
// AGENDA G1d — la configuración de la agenda (especialidades, horarios por
// doctor, bloqueos, duraciones). Server component mínimo: el guard de admin
// lo pone el layout de /ajustes; los datos los carga el client de su API.

import AgendaConfigView from "./AgendaConfigView";

export const dynamic = "force-dynamic";

export default function AjustesAgendaPage() {
  return <AgendaConfigView />;
}
