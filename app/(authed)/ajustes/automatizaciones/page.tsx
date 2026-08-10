// app/(authed)/ajustes/automatizaciones/page.tsx
//
// Cómo se comporta el seguimiento automático: qué hace solo y cada cuánto.
// Las dos secciones van juntas a propósito — «Automatizaciones» decide si el
// seguimiento está activo y «Recordatorios» cada cuántos días toca. Estaban en
// dos entradas distintas del menú viejo y se solapaban (MEJORAS 13).

import { userDeAjustes } from "../sesion";
import {
  SectionAutomatizaciones,
  SectionRecordatorios,
} from "../../../components/ajustes/PanelesConfiguracion";

export const dynamic = "force-dynamic";

export default async function AjustesAutomatizacionesPage() {
  const user = await userDeAjustes();
  return (
    <div className="space-y-10">
      <SectionAutomatizaciones user={user} />
      <div className="border-t border-[var(--color-border)] pt-10">
        <SectionRecordatorios user={user} />
      </div>
    </div>
  );
}
