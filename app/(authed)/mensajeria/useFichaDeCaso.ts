"use client";

// LA FICHA, UNA VEZ POR CONVERSACIÓN (auditoría 2026-09-05, MEJORAS 119).
//
// El composer necesita el borrador del evaluador y el opt-out; la columna
// derecha necesita la ficha entera. Las dos leen el MISMO objeto: pedirlo
// dos veces sería dos verdades sobre el mismo caso (la doctrina del `caso`).
// La pantalla la pide aquí y la reparte.

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** De QUIÉN es la ficha que hay en pantalla. */
  const deQuien = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    if (!telefono) {
      deQuien.current = null;
      setFicha(null);
      setError(null);
      return;
    }
    // CAMBIAR DE CONVERSACIÓN VACÍA LA FICHA; REFRESCAR LA MISMA, NO (15-09).
    // La regla de «conservar lo último bueno» (§10) es correcta cuando falla
    // el refresco de ESTA conversación: no se castiga al usuario por un fallo
    // de red. Pero al cambiar de persona, «lo último bueno» es de OTRA — y
    // durante el tiempo que tarda la petición se veía la conversación de una
    // con los datos de salud de la otra. Medido por Simon el 15-09 usando
    // Mensajería de verdad, y no es un detalle estético.
    if (deQuien.current !== telefono) {
      deQuien.current = telefono;
      setFicha(null);
      setError(null);
    }
    setCargando(true);
    setError(null);
    const pedidoPara = telefono;
    try {
      const d = await cargarJSON<FichaCaso>(`/api/agente/ficha?telefono=${encodeURIComponent(telefono)}`);
      // La respuesta puede llegar DESPUÉS de que el usuario haya cambiado de
      // chat (dos peticiones en vuelo, la lenta llega la última). Se descarta:
      // pintar una ficha que ya no es de la conversación abierta es el mismo
      // bug por otro camino.
      if (deQuien.current === pedidoPara) setFicha(d);
    } catch (e) {
      if (deQuien.current === pedidoPara) setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [telefono]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return { ficha, error, cargando, recargar: cargar };
}
