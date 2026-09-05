"use client";

// LA FICHA, UNA VEZ POR CONVERSACIÓN (auditoría 2026-09-05, MEJORAS 119).
//
// El composer necesita el borrador del evaluador y el opt-out; la columna
// derecha necesita la ficha entera. Las dos leen el MISMO objeto: pedirlo
// dos veces sería dos verdades sobre el mismo caso (la doctrina del `caso`).
// La pantalla la pide aquí y la reparte.

import { useCallback, useEffect, useState } from "react";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import type { FichaCaso } from "../../lib/agente/ficha-caso";

export function useFichaDeCaso(telefono: string | null): {
  ficha: FichaCaso | null;
  error: string | null;
  cargando: boolean;
  recargar: () => void;
} {
  const [ficha, setFicha] = useState<FichaCaso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!telefono) {
      setFicha(null);
      setError(null);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      setFicha(await cargarJSON<FichaCaso>(`/api/agente/ficha?telefono=${encodeURIComponent(telefono)}`));
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10): no se vacía la ficha
      // por un fallo de red.
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [telefono]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return { ficha, error, cargando, recargar: cargar };
}
