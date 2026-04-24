// app/(authed)/ajustes/page.tsx
// Redirect a la única sub-sección poblada en Sprint 7 Fase 6.

import { redirect } from "next/navigation";

export default function AjustesIndexPage() {
  redirect("/ajustes/clinica-equipo");
}
