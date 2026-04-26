// app/(authed)/layout.tsx
// Route group `(authed)` — monta sesión, clínicas accesibles y header global.
// Sprint 7 Fase 4.

import { redirect } from "next/navigation";
import { getSession } from "../lib/auth/session";
import { listClinicas, listClinicaIdsForUser } from "../lib/auth/users";
import {
  ClinicProvider,
  type ClinicContextSession,
  type Clinica as CtxClinica,
} from "../lib/context/ClinicContext";
import { GlobalHeader } from "../components/layout/GlobalHeader";
import { FyllioCopilot } from "../components/copilot/FyllioCopilot";

export const dynamic = "force-dynamic";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const allClinicas = await listClinicas({ onlyActivas: true });

  // Para coord, calculamos sus clínicas accesibles reales desde la junction.
  // Para admin, clinicasAccesibles ya es ["*"] — las ve todas.
  const clinicasAccesibles =
    session.rol === "admin"
      ? ["*"]
      : await listClinicaIdsForUser(session.userId);

  const ctxSession: ClinicContextSession = {
    userId: session.userId,
    nombre: session.nombre,
    rol: session.rol,
    clinicasAccesibles,
  };

  const clinicas: CtxClinica[] = allClinicas.map((c) => ({ id: c.id, nombre: c.nombre }));

  return (
    <ClinicProvider session={ctxSession} clinicas={clinicas}>
      <div className="min-h-screen flex flex-col">
        <GlobalHeader />
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
      <FyllioCopilot />
    </ClinicProvider>
  );
}
