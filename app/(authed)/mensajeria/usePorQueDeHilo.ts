"use client";

// 2.8 (MEJORAS 183): los turnos explicados del hilo abierto — «ver por qué»
// por mensaje. Se piden UNA vez por hilo y se recargan con él (la `version`
// es el objeto del hilo: cambia cuando se vuelve a cargar tras enviar).
//
// §10: un fallo conserva lo último bueno y se dice; nunca «este agente no
// decidió nada aquí» por un 500. Lo cargado va atado a SU teléfono: al
// cambiar de hilo no se enseña lo del anterior (las filas son otras) sin
// necesitar un efecto que lo vacíe.

import { useEffect, useState } from "react";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import type { TurnoExplicado } from "../../lib/agente/por-que";

export function usePorQueDeHilo(
  telefono: string | null,
  version: unknown,
): { turnos: TurnoExplicado[] | null; error: string | null; recargar: () => void } {
  const [cargado, setCargado] = useState<{ telefono: string; turnos: TurnoExplicado[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!telefono) return;
    let vivo = true;
    cargarJSON<{ turnos: TurnoExplicado[] }>(`/api/agente/por-que?telefono=${encodeURIComponent(telefono)}`)
      .then((d) => {
        if (!vivo) return;
        setCargado({ telefono, turnos: d.turnos });
        setError(null);
      })
      .catch((e) => {
        if (vivo) setError(mensajeDeError(e));
      });
    return () => {
      vivo = false;
    };
  }, [telefono, version, intento]);

  return {
    turnos: telefono && cargado?.telefono === telefono ? cargado.turnos : null,
    error: telefono ? error : null,
    recargar: () => setIntento((n) => n + 1),
  };
}
