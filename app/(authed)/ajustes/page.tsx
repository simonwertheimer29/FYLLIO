// app/(authed)/ajustes/page.tsx
// Entrada de Ajustes → la primera sección de la barra.

import { redirect } from "next/navigation";

export default function AjustesIndexPage() {
  redirect("/ajustes/objetivos");
}
