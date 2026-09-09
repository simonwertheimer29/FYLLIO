"use client";

// LA LÍNEA DEL DISPARADOR DE MODO B — una sola frase, en dos pantallas
// (Confianza del agente e Inicio › Tu equipo). Antes cada una la redactaba a
// su manera en un párrafo; regla A del estándar visual (9-sep): el umbral es
// un dato, no una explicación. Lo que explica va al tooltip y es prescindible.

import { DISPARADOR_MODO_B, disparadorModoB } from "../../lib/agente/confianza.tipos";
import type { ResumenCoincidencia } from "../../lib/automatizacion/coincidencia";

const TOOLTIP = `Que el agente envíe solo los mensajes rutinarios sin revisión. Se plantea cuando el equipo manda tal cual al menos el ${DISPARADOR_MODO_B.tasaTalCual} % de ${DISPARADOR_MODO_B.envios} envíos.`;

export function LineaModoB({ co, className = "mt-1" }: { co: Pick<ResumenCoincidencia, "total" | "tasaTalCual">; className?: string }) {
  const disp = disparadorModoB(co);
  return (
    <p className={`${className} tabular-nums`} title={TOOLTIP}>
      Objetivo: {DISPARADOR_MODO_B.tasaTalCual} % tal cual de {DISPARADOR_MODO_B.envios} envíos ·{" "}
      {disp.alcanzado ? (
        <b className="font-semibold text-[var(--color-foreground)]">se cumple, es momento de decidirlo</b>
      ) : (
        <>todavía no: {disp.motivo}</>
      )}
    </p>
  );
}
