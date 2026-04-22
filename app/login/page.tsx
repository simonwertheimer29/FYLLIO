// app/login/page.tsx — Panel de gestión.
// Server component: carga clínicas activas y delega UI interactiva al client.

import { listClinicas } from "../lib/auth/users";
import { LoginView } from "./LoginView";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const clinicas = await listClinicas({ onlyActivas: true });
  return (
    <LoginView
      clinicas={clinicas.map((c) => ({ id: c.id, nombre: c.nombre, ciudad: c.ciudad }))}
    />
  );
}
