"use client";

// La columna izquierda de la bandeja.
//
// Dos cosas de las que no se baja, porque el fallo se ha visto en producto real:
//
//   1. La previsualización pinta TEXTO. `{conv.ultimoTexto}` en un nodo de
//      texto de React, que escapa solo. Ni `dangerouslySetInnerHTML` ni
//      markdown renderizado: lo que hay ahí lo escribió un paciente.
//   2. Si no hay nombre, no se enseña un número a secas mientras quede algo
//      mejor. La cadena la resuelve el servidor —paciente → lead → perfil de
//      WhatsApp → número— y aquí solo se dice de dónde salió cuando no es
//      fiable, para que nadie confunda un nombre de perfil con un paciente
//      fichado.

import { AlertTriangle, Sparkles, ICON_STROKE } from "../../components/icons";
import { StatePill } from "../../components/ui/StatePill";
import { fechaClinica, horaClinica, hoyISO } from "../../lib/time";
import type { Conversacion, FiltroBandeja } from "../../lib/mensajeria/conversaciones";

export const FILTROS: Array<{ id: FiltroBandeja; label: string }> = [
  { id: "pendientes", label: "Pendientes" },
  { id: "todas", label: "Todas" },
  // El que ninguna herramienta genérica tiene: qué ha estado contestando el
  // agente. En modo A son los mensajes que él redactó y una persona envió.
  { id: "agente", label: "Ha respondido el agente" },
  { id: "necesita-persona", label: "Necesita persona" },
];

/** Como WhatsApp: hora si es de hoy, fecha si no. El «hoy» es el DÍA DE LA
 *  CLÍNICA (§13), no el del navegador — si no, la misma bandeja enseña cosas
 *  distintas según desde dónde se mire. */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  const esDeHoy = hoyISO(d) === hoyISO();
  return esDeHoy ? horaClinica(d) : fechaClinica(iso);
}

export function ListaConversaciones({
  conversaciones,
  seleccionada,
  onSeleccionar,
  mostrarClinica,
}: {
  conversaciones: Conversacion[];
  seleccionada: string | null;
  onSeleccionar: (telefono: string) => void;
  /** Con «Todas las clínicas» cada línea dice de cuál es; con una seleccionada
   *  el distintivo sobra y solo hace ruido. */
  mostrarClinica: boolean;
}) {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {conversaciones.map((c) => {
        const activa = c.telefono === seleccionada;
        return (
          <li key={c.telefono}>
            <button
              type="button"
              onClick={() => onSeleccionar(c.telefono)}
              aria-current={activa ? "true" : undefined}
              className={`w-full px-3 py-3 text-left transition-colors ${
                activa
                  ? "bg-[var(--color-accent-soft)]"
                  : "hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-foreground)]">
                  {c.nombre}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-muted)]">
                  {horaCorta(c.ultimoAt)}
                </span>
              </div>

              <div className="mt-0.5 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-muted)]">
                  {c.ultimoEs === "Saliente" && (
                    <span className="text-[var(--color-muted)]">Tú: </span>
                  )}
                  {c.ultimoTexto}
                </p>
                {c.pendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--color-on-accent)]">
                    {c.pendientes}
                  </span>
                )}
              </div>

              {(c.necesitaPersona ||
                c.ultimaDelAgente ||
                c.origenNombre === "perfil" ||
                c.origenNombre === "telefono" ||
                (mostrarClinica && c.clinicaNombre)) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {c.necesitaPersona && (
                    <StatePill variant="danger" size="sm">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      Necesita persona
                    </StatePill>
                  )}
                  {c.ultimaDelAgente && !c.necesitaPersona && (
                    <StatePill variant="info" size="sm">
                      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                      Contestó el agente
                    </StatePill>
                  )}
                  {/* Un nombre de perfil de WhatsApp NO es un paciente fichado.
                      Decirlo evita que alguien lea la lista creyendo que todos
                      están en el sistema. */}
                  {c.origenNombre === "perfil" && (
                    <StatePill variant="neutral" size="sm">
                      Sin ficha
                    </StatePill>
                  )}
                  {c.origenNombre === "telefono" && (
                    <StatePill variant="neutral" size="sm">
                      Sin nombre
                    </StatePill>
                  )}
                  {mostrarClinica && c.clinicaNombre && (
                    <span className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      {c.clinicaNombre}
                    </span>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** La banda de «sin asignar». No es un filtro aparte a propósito: lo que no
 *  aparece en la vista por defecto no se mira, y estos son precisamente los que
 *  hoy no mira nadie. */
export function BandaSinAsignar({
  n,
  accesoDeRed,
}: {
  n: number;
  accesoDeRed: boolean;
}) {
  if (n === 0) return null;
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
      <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
        {n} {n === 1 ? "conversación sin clínica" : "conversaciones sin clínica"}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        {accesoDeRed
          ? "De alguien que no está en ningún caso todavía. Ábrelas para decir quién es."
          : "Solo visibles con acceso de red: sin clínica asignada no se puede saber si son de una de las tuyas."}
      </p>
    </div>
  );
}
