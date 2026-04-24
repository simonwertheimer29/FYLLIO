// app/(authed)/layout.tsx
// Route group `(authed)` — envuelve las rutas autenticadas del Sprint 7.
// Valida fyllio_session (redirect a /login si falta) y monta el Provider +
// GlobalHeader. El trailing route group NO altera las URLs públicas.
//
// Nota Sprint 7: en próximos commits se montan <ClinicProvider> + <GlobalHeader>
// aquí. Este commit solo introduce el guard de sesión.

import { redirect } from "next/navigation";
import { getSession } from "../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return <>{children}</>;
}
