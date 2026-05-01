// app/(authed)/pacientes/[id]/page.tsx
// Sprint 14a Bloque 1.5 — ruta hub central del paciente por recordId.
// El componente cliente hace el fetch a /api/pacientes/[id] que aplica
// auth + scope clínica.

import Paciente360View from "../../../components/pacientes/Paciente360View";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function PacientePage({ params }: Props) {
  const { id } = await params;
  return <Paciente360View pacienteId={id} />;
}
