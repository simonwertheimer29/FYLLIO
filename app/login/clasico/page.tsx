// app/login/clasico/page.tsx — acceso clásico por clínica (respaldo).
// Es el flujo anterior al login email+PIN (jul 2026): imprescindible mientras
// haya usuarios sin email asignado. Server component: carga clínicas activas.

import type { Metadata } from "next";
import { listClinicas } from "../../lib/auth/users";
import { LoginView } from "../LoginView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fyllio — acceso por clínica",
  robots: { index: false, follow: false },
};

export default async function LoginClasicoPage() {
  const clinicas = await listClinicas({ onlyActivas: true });
  return (
    <LoginView
      clinicas={clinicas.map((c) => ({ id: c.id, nombre: c.nombre, ciudad: c.ciudad }))}
    />
  );
}
