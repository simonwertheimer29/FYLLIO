// app/login/page.tsx — login email+PIN (rediseño jul 2026).
// El flujo clásico por clínica sigue disponible en /login/clasico como
// respaldo para usuarios que aún no tienen email asignado.

import { LoginFlow } from "./LoginFlow";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginFlow />;
}
