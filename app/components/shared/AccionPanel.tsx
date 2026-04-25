"use client";

// Sprint 9 fix unificación — entry point único del panel lateral derecho.
// Parametrizado por `kind`. La rama "presupuesto" delega a IntervencionSidePanel
// (intacto desde Sprint 8). La rama "lead" usa LeadAccionPanel (estructura
// visual idéntica, datos y endpoints de Lead).

import IntervencionSidePanel from "../presupuestos/IntervencionSidePanel";
import { LeadAccionPanel } from "./LeadAccionPanel";
import type {
  PresupuestoIntervencion,
  PresupuestoEstado,
} from "../../lib/presupuestos/types";
import type { Lead } from "../../(authed)/leads/types";

type Props =
  | {
      kind: "presupuesto";
      item: PresupuestoIntervencion;
      onClose: () => void;
      onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
      onRefresh: () => void;
    }
  | {
      kind: "lead";
      item: Lead;
      onClose: () => void;
      onChanged: (l: Lead) => void;
      onAsistencia: (l: Lead) => void;
    };

export function AccionPanel(props: Props) {
  if (props.kind === "presupuesto") {
    return (
      <IntervencionSidePanel
        item={props.item}
        onClose={props.onClose}
        onChangeEstado={props.onChangeEstado}
        onRefresh={props.onRefresh}
      />
    );
  }
  return (
    <LeadAccionPanel
      lead={props.item}
      onClose={props.onClose}
      onChanged={props.onChanged}
      onAsistencia={props.onAsistencia}
    />
  );
}
