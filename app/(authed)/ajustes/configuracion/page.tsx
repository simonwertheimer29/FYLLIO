// app/(authed)/ajustes/configuracion/page.tsx
// Sprint 14b Bloque 0 — panel de configuración por clínica.
// Server component: solo carga la lista de clínicas para el selector;
// el resto vive en el client component.

import { listClinicas } from "../../../lib/auth/users";
import ConfiguracionView from "./ConfiguracionView";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const clinicas = await listClinicas({ onlyActivas: true });
  return <ConfiguracionView clinicas={clinicas.map((c) => ({ id: c.id, nombre: c.nombre }))} />;
}
