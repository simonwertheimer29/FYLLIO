"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinScreen } from "../../components/auth/PinScreen";

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(pin: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "PIN incorrecto");
        return;
      }
      // Sprint 8: admin aterriza en /red (dashboard macro, admin-only).
      router.push("/red");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PinScreen
      digits={6}
      title="Administrador"
      subtitle="Introduce tu PIN de 6 dígitos"
      backHref="/login"
      onSubmit={submit}
      loading={loading}
      error={error}
    />
  );
}
