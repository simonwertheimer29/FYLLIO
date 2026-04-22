// app/login/clinica/[id]/page.tsx
// Pantalla PIN 4 dígitos para coordinación. Valida clinicaId contra las
// clínicas activas; si no existe/inactiva → redirect a /login.

import { redirect } from "next/navigation";
import { listClinicas } from "../../../lib/auth/users";
import { CoordPinView } from "./CoordPinView";

export const dynamic = "force-dynamic";

export default async function ClinicaLoginPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clinicas = await listClinicas({ onlyActivas: true });
  const clinica = clinicas.find((c) => c.id === id);
  if (!clinica) redirect("/login");

  return <CoordPinView clinica={{ id: clinica.id, nombre: clinica.nombre }} />;
}
