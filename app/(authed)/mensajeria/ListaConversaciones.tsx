"use client";

// La columna izquierda: buscador, filtros y lista.
//
// Los filtros viven AQUÍ y no en la cabecera de la página porque son de la
// lista, no de la pantalla: lo que cambian es qué conversaciones se ven, no qué
// hace /mensajeria. En la cabecera, además, competían con el título y el aviso
// de clínica por la misma franja.
//
// Dos cosas de las que no se baja, porque el fallo se ha visto en producto real:
//
//   1. La previsualización pinta TEXTO. `{c.ultimoTexto}` en un nodo de texto de
//      React, que escapa solo. Ni `dangerouslySetInnerHTML` ni markdown: lo que
//      hay ahí lo escribió un paciente.
//   2. Si no hay nombre, no se enseña un número mientras quede algo mejor. La
//      cadena la resuelve el servidor —paciente → lead → perfil de WhatsApp →
//      número— y aquí solo se dice de dónde salió cuando no es fiable.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Sparkles,
  MessageCircle,
  Inbox,
  UserCheck,
  Search,
  ICON_STROKE,
} from "../../components/icons";
import { iniciales } from "../../components/shared/panel-accion-ui";
import { fechaClinica, horaClinica, hoyISO } from "../../lib/time";
import type { Conversacion, FiltroBandeja } from "../../lib/mensajeria/conversaciones";

export const FILTROS: Array<{
  id: FiltroBandeja;
  label: string;
  Icono: typeof Inbox;
  ayuda: string;
}> = [
  { id: "pendientes", label: "Pendientes", Icono: Inbox, ayuda: "Han escrito y no se ha contestado" },
  { id: "todas", label: "Todas", Icono: MessageCircle, ayuda: "Todas las conversaciones" },
  // El que ninguna herramienta genérica tiene: qué ha estado contestando el
  // agente. En modo A son los mensajes que él redactó y una persona envió.
  { id: "agente", label: "Agente", Icono: Sparkles, ayuda: "Ha respondido el agente" },
  {
    id: "necesita-persona",
    label: "Tu criterio",
    Icono: UserCheck,
    ayuda: "Necesitan que decida una persona",
  },
];

/** Como WhatsApp: hora si es de hoy, fecha si no. El «hoy» es el DÍA DE LA
 *  CLÍNICA (§13), no el del navegador — si no, la misma bandeja enseña cosas
 *  distintas según desde dónde se mire. */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  return hoyISO(d) === hoyISO() ? horaClinica(d) : fechaClinica(iso);
}

/** El color del avatar sale del nombre, así que la misma persona tiene siempre
 *  el mismo. No es decoración: es lo que permite reconocer una fila sin leerla.
 *  Todos son variaciones del acento — un solo acento en toda la app (§1). */
const TONOS = [
  "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]",
  "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
];
function tonoDe(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return TONOS[h % TONOS.length];
}

export function FiltrosBandeja({
  activo,
  onCambiar,
}: {
  activo: FiltroBandeja;
  onCambiar: (f: FiltroBandeja) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
      {FILTROS.map((f) => {
        const on = activo === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onCambiar(f.id)}
            title={f.ayuda}
            aria-pressed={on}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[12px] font-semibold transition-colors ${
              on
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            }`}
          >
            <f.Icono size={14} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
            <span className="truncate">{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Buscador({
  valor,
  onCambiar,
}: {
  valor: string;
  onCambiar: (v: string) => void;
}) {
  return (
    <div className="relative px-3 pb-2.5 pt-3">
      <Search
        size={14}
        strokeWidth={ICON_STROKE}
        className="pointer-events-none absolute left-[1.375rem] top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
        aria-hidden
      />
      <input
        type="search"
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        placeholder="Buscar por nombre o teléfono"
        aria-label="Buscar conversaciones"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-3 text-[13px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
    </div>
  );
}

/** Filtra por nombre o teléfono. Se hace en el cliente sobre lo ya cargado: la
 *  lista viene acotada, así que buscar aquí es inmediato y no gasta una consulta
 *  por tecla. El teléfono se compara SIN símbolos para que «664 485» encuentre
 *  «+34664485815» — si no, buscar por teléfono no sirve para nada. */
export function filtrarPorBusqueda(cs: Conversacion[], q: string): Conversacion[] {
  const t = q.trim().toLowerCase();
  if (!t) return cs;
  const soloDigitos = t.replace(/\D/g, "");
  return cs.filter(
    (c) =>
      c.nombre.toLowerCase().includes(t) ||
      (soloDigitos.length >= 3 && c.telefono.replace(/\D/g, "").includes(soloDigitos)),
  );
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
    <ul className="space-y-1 px-2 pb-3">
      {conversaciones.map((c) => {
        const activa = c.telefono === seleccionada;
        const señales =
          c.necesitaPersona ||
          c.ultimaDelAgente ||
          c.origenNombre === "perfil" ||
          c.origenNombre === "telefono";
        return (
          <li key={c.telefono}>
            <button
              type="button"
              onClick={() => onSeleccionar(c.telefono)}
              aria-current={activa ? "true" : undefined}
              className={`flex w-full gap-2.5 rounded-xl border px-3 py-3 text-left transition-colors ${
                activa
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${tonoDe(c.nombre)}`}
              >
                {iniciales(c.nombre)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--color-foreground)]">
                    {c.nombre}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-muted)]">
                    {horaCorta(c.ultimoAt)}
                  </span>
                </span>

                <span className="mt-1 flex items-start gap-2">
                  {/* Dos líneas, no una: había ancho de sobra y la vista previa
                      se cortaba a mitad de la primera frase, que es justo donde
                      está lo que hace falta para decidir si abrirla. */}
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--color-muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                    {c.ultimoEs === "Saliente" && <span className="opacity-70">Tú: </span>}
                    {c.ultimoTexto}
                  </span>
                  {c.pendientes > 0 && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--color-on-accent)]">
                      {c.pendientes}
                    </span>
                  )}
                </span>

                {(señales || (mostrarClinica && c.clinicaNombre)) && (
                  <span className="mt-2 flex flex-wrap items-center gap-1">
                    {c.necesitaPersona && (
                      <Marca tono="danger" Icono={AlertTriangle}>
                        Tu criterio
                      </Marca>
                    )}
                    {c.ultimaDelAgente && !c.necesitaPersona && (
                      <Marca tono="accent" Icono={Sparkles}>
                        Agente
                      </Marca>
                    )}
                    {/* Un nombre de perfil de WhatsApp NO es un paciente fichado.
                        Decirlo evita leer la lista creyendo que todos lo están. */}
                    {c.origenNombre === "perfil" && <Marca tono="neutro">Sin ficha</Marca>}
                    {c.origenNombre === "telefono" && <Marca tono="neutro">Sin nombre</Marca>}
                    {/* Chip, no una línea entera en mayúsculas: el nombre de la
                        clínica se comía un renglón de cada fila. */}
                    {mostrarClinica && c.clinicaNombre && (
                      <Marca tono="neutro">{c.clinicaNombre}</Marca>
                    )}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Marca({
  tono,
  Icono,
  children,
}: {
  tono: "danger" | "accent" | "neutro";
  Icono?: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  const cls =
    tono === "danger"
      ? "border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : tono === "accent"
        ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        : "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {Icono && <Icono className="h-2.5 w-2.5 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** La banda de «sin asignar». No es un filtro aparte a propósito: lo que no
 *  aparece en la vista por defecto no se mira, y estos son precisamente los que
 *  hoy no mira nadie. */
export function BandaSinAsignar({ n, accesoDeRed }: { n: number; accesoDeRed: boolean }) {
  if (n === 0) return null;
  return (
    <div className="mx-3 mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
      <p className="text-[12.5px] font-semibold text-[var(--color-foreground)]">
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
