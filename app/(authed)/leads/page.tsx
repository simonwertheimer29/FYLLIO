// app/(authed)/leads/page.tsx
// Server component — carga leads iniciales + lista de clínicas + doctores.
// El filtrado por ClinicContext + estado + búsqueda + fecha se hace client-side.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth/session";
import { listClinicas } from "../../lib/auth/users";
import { listLeads } from "../../lib/leads/leads";
import { listDoctores } from "@/lib/staff/doctores";
import { runWithCliente } from "../../lib/cliente-contexto";
import { clinicasNegocioAccesibles, negocioIdToCentralId } from "../../lib/clinicas-negocio";
import { ultimosMensajesPorConversacion } from "../../lib/presupuestos/mensajeria";
import { ultimasAccionesDireccionPorLead } from "../../lib/leads/acciones";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
} from "../../lib/presupuestos/estado-conversacion";
import { LeadsView } from "./LeadsView";

export const dynamic = "force-dynamic";


export default async function LeadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Sprint B — el render llama a base() (Staff, Leads); fijar el contexto de
  // cliente. Filtramos por IDs de clínica de NEGOCIO y remapeamos cada clinicaId
  // al ID CENTRAL (por nombre) para que el filtro cliente-side por ClinicContext
  // coincida. Sin esto, el coord veía la tabla de leads vacía.
  const { allClinicas, doctores, leadsWithClinica } = await runWithCliente(
    session.cliente,
    async () => {
      const [allClinicas, scope, doctores] = await Promise.all([
        listClinicas({ onlyActivas: true, cliente: session.cliente }),
        clinicasNegocioAccesibles(session),
        listDoctores(),
      ]);
      const [leads, ultimos, accionesLead] = await Promise.all([
        listLeads({ clinicaIds: scope.ids === null ? undefined : scope.ids }),
        // Pasada visual 2026-07-27 — la card necesita decir algo verdadero
        // sobre el tiempo ("sin respuesta hace 3 días" NO se puede medir desde
        // la captación). Se leen las MISMAS fuentes que /red y /seguimiento y
        // se clasifica con el MISMO motor: aquí no nace ningún criterio.
        ultimosMensajesPorConversacion(),
        ultimasAccionesDireccionPorLead(),
      ]);
      const masReciente = (a?: string | null, b?: string | null) =>
        !a ? (b ?? null) : !b || a > b ? a : b;
      const leadsWithClinica = leads.map((l) => {
        const hilo = ultimos.porLead.get(l.id);
        const entranteAt = masReciente(accionesLead.entrantePorLead[l.id], hilo?.entranteAt);
        const salienteAt = masReciente(accionesLead.salientePorLead[l.id], hilo?.salienteAt);
        return {
          ...l,
          clinicaId: negocioIdToCentralId(scope, l.clinicaId),
          clinicaNombre: l.clinicaId ? scope.nombreById.get(l.clinicaId) ?? null : null,
          entranteAt,
          salienteAt,
          conversacion: estadoConversacion(
            { ultimoEntranteAt: entranteAt, ultimoSalienteAt: salienteAt },
            UMBRAL_REACTIVACION_MS.lead,
          ).estado,
        };
      });
      const doctoresCentral = doctores.map((d) => ({
        ...d,
        clinicaId: negocioIdToCentralId(scope, d.clinicaId),
      }));
      return { allClinicas, doctores: doctoresCentral, leadsWithClinica };
    },
  );

  return (
    <LeadsView
      initialLeads={leadsWithClinica}
      clinicasSelectables={allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      doctores={doctores}
    />
  );
}
