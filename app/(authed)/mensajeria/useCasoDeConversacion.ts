"use client";

// El caso vivo de una conversación.
//
// ─── La decisión que faltaba: qué caso manda cuando hay dos ────────────────
//
// La conversación es un TELÉFONO, y un teléfono puede tocar varios casos. La
// regla, decidida el 2026-08-11 con los datos delante:
//
//   **manda el caso ABIERTO; si hubiera varios, el de actividad más reciente;
//   los cerrados son historial.**
//
// Y los datos importan porque cambian qué clase de problema es esto: hoy hay
// **cero** teléfonos con más de un caso abierto. Los 26 que tocan dos casos son
// lead `Convertido` + presupuesto, o sea la misma historia contada dos veces —
// entró como lead, se convirtió, ahora tiene presupuesto. **Es un ciclo de
// vida, no una ambigüedad.** Por eso no hay un selector de caso: metería una
// decisión en la cabeza de la coordinadora en las 346 conversaciones donde no
// hay nada que decidir.
//
// Pero «hoy no pasa» no es «no va a pasar» —dos presupuestos vivos del mismo
// paciente es perfectamente posible—, así que cuando ocurra se avisa (§9: los
// fallos no son silenciosos). Enterarse por un log es mejor que enterarse
// porque alguien note que la pantalla eligió uno por su cuenta.

import { useCallback, useEffect, useState } from "react";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import type { PresupuestoIntervencion } from "../../lib/presupuestos/types";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";

export type CasoDeConversacion = {
  tipo: "presupuesto";
  item: PresupuestoIntervencion;
};

type Estado = {
  caso: CasoDeConversacion | null;
  cargando: boolean;
  /** `null` = no falló. Un caso que no se pudo cargar NO es lo mismo que una
   *  conversación sin caso, y la capa de acción los dice distinto. */
  error: string | null;
};

export function useCasoDeConversacion(conversacion: Conversacion | null): Estado & {
  recargar: () => void;
} {
  const [estado, setEstado] = useState<Estado>({ caso: null, cargando: false, error: null });

  const presupuestoId = conversacion?.presupuestoId ?? null;
  const telefono = conversacion?.telefono ?? null;

  const cargar = useCallback(async () => {
    if (!presupuestoId) {
      setEstado({ caso: null, cargando: false, error: null });
      return;
    }
    setEstado((p) => ({ ...p, cargando: true, error: null }));
    try {
      // Este endpoint ya existía: lo construyó el panel del kanban para pedir
      // UN caso enriquecido (días sin contacto, intención, motivo de quiebre,
      // mensaje sugerido). La bandeja no necesita ruta nueva.
      const d = await cargarJSON<{ item: PresupuestoIntervencion | null }>(
        `/api/presupuestos/intervencion?id=${encodeURIComponent(presupuestoId)}`,
      );
      setEstado({
        caso: d.item ? { tipo: "presupuesto", item: d.item } : null,
        cargando: false,
        error: d.item ? null : "El caso de esta conversación ya no está disponible.",
      });
    } catch (e) {
      setEstado({ caso: null, cargando: false, error: mensajeDeError(e) });
    }
  }, [presupuestoId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El aviso de la regla. Se comprueba con lo que sabe la lista: si una misma
  // conversación trae presupuesto Y lead, y el lead no está cerrado, es el caso
  // que la regla no ha tenido que desempatar todavía.
  useEffect(() => {
    if (!conversacion?.presupuestoId || !conversacion?.leadId) return;
    console.warn(
      `[mensajeria] la conversación de ${telefono} toca dos casos ` +
        `(presupuesto ${conversacion.presupuestoId} · lead ${conversacion.leadId}). ` +
        "Se enseña el presupuesto. Si el lead sigue abierto, la regla de «el caso vivo manda» " +
        "está desempatando por primera vez y conviene mirarlo.",
    );
  }, [conversacion?.presupuestoId, conversacion?.leadId, telefono]);

  return { ...estado, recargar: cargar };
}
