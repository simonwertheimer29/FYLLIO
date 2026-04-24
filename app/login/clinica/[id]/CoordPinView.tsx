"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinScreen } from "../../../components/auth/PinScreen";

type Props = { clinica: { id: string; nombre: string } };

export function CoordPinView({ clinica }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(pin: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: clinica.id, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "PIN incorrecto");
        return;
      }
      // Temporal: /ajustes se crea en Fase 6. Coord aterriza en /presupuestos
       // (vista más usada). En Fase 6 se reevalúa el destino por rol.
       router.push("/presupuestos");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PinScreen
      digits={4}
      title={`Coordinación ${clinica.nombre}`}
      subtitle="Introduce tu PIN de 4 dígitos"
      backHref="/login"
      onSubmit={submit}
      loading={loading}
      error={error}
    />
  );
}
