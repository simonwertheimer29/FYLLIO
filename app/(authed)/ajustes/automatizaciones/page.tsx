// app/(authed)/ajustes/automatizaciones/page.tsx
//
// Cómo se comporta el seguimiento automático. F6: el editor de
// «Recordatorios» MURIÓ de aquí — eran DOS editores sobre el MISMO almacén
// (este y el grupo Cadencias de la config del agente), y dos editores del
// mismo dato es una incoherencia esperando a que alguien guarde en el que
// no mira el otro. Queda UNO (el del agente); aquí se enlaza.

import Link from "next/link";
import { userDeAjustes } from "../sesion";
import { SectionAutomatizaciones } from "../../../components/ajustes/PanelesConfiguracion";

export const dynamic = "force-dynamic";

export default async function AjustesAutomatizacionesPage() {
  const user = await userDeAjustes();
  return (
    <div className="space-y-10">
      <SectionAutomatizaciones user={user} />
      <div className="border-t border-[var(--color-border)] pt-8">
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Cadencias y recordatorios
        </h2>
        <p className="mt-1 max-w-xl text-[13px] text-[var(--color-muted)]">
          Los días de la secuencia de seguimiento, los toques antes de agotar y
          los recordatorios de cita se editan en un único sitio: la
          configuración del agente. Editarlos también aquí era guardar el mismo
          dato desde dos pantallas.
        </p>
        <Link
          href="/agentes/conversacional"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          Abrir la configuración del agente
        </Link>
      </div>
    </div>
  );
}
