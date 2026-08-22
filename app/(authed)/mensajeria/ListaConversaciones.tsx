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

import {
  AlertTriangle,
  Sparkles,
  UserCheck,
  Hourglass,
  MessageCircle,
  Search,
  ICON_STROKE,
} from "../../components/icons";
import { iniciales } from "../../components/shared/panel-accion-ui";
import { fechaClinica, horaClinica, hoyISO } from "../../lib/time";
import type {
  Conversacion,
  EstadoFlujo,
  FiltroBandeja,
  OrdenBandeja,
} from "../../lib/mensajeria/conversaciones";

// Fase C (22-08): la bandeja es la lista COMPLETA y estos tres son LENTES que
// la estrechan — uno activo o ninguno (volver a pulsarlo lo apaga). No son
// carpetas: los conjuntos se solapan y nada se reparte ni desaparece.
export const FILTROS: Array<{
  id: FiltroBandeja;
  label: string;
  Icono: typeof UserCheck;
  ayuda: string;
}> = [
  {
    id: "necesitan-de-mi",
    label: "Necesitan de mí",
    Icono: UserCheck,
    ayuda: "Esperan una acción tuya — el mismo criterio que la cola de Seguimiento",
  },
  {
    id: "agente",
    label: "Las lleva el agente",
    Icono: Sparkles,
    ayuda: "El agente es quien está contestando",
  },
  // El que no existe en ninguna otra parte del producto, y donde se pierde el
  // dinero: escribiste tú, nadie contesta, y el caso se enfría solo — no
  // reclama y no sale en Seguimiento.
  {
    id: "sin-respuesta",
    label: "Mías sin respuesta",
    Icono: Hourglass,
    ayuda: "Escribiste tú y el paciente no ha contestado",
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
  orden,
  onOrden,
}: {
  /** null = sin lente: la lista completa (la vista por defecto). */
  activo: FiltroBandeja | null;
  onCambiar: (f: FiltroBandeja | null) => void;
  orden: OrdenBandeja;
  onOrden: (o: OrdenBandeja) => void;
}) {
  // «Todas» delante y por defecto (22-08): sin él, ver todo era un estado
  // sin botón — había que descubrir que pulsar el filtro activo lo apagaba.
  const botones: Array<{ id: FiltroBandeja | null; label: string; Icono: typeof UserCheck; ayuda: string }> = [
    { id: null, label: "Todas", Icono: MessageCircle, ayuda: "Todas las conversaciones" },
    ...FILTROS,
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        {botones.map((f) => {
          const on = activo === f.id;
          return (
            <button
              key={f.id ?? "todas"}
              type="button"
              onClick={() => onCambiar(on ? null : f.id)}
              title={f.ayuda}
              aria-pressed={on}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-left text-[11.5px] font-semibold transition-colors ${
                on
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <f.Icono size={13} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
              <span className="truncate">{f.label}</span>
            </button>
          );
        })}
      </div>
      {/* El ORDEN, abajo y separado (dictado): los filtros REDUCEN la lista,
          esto la REORDENA — en la misma fila parecía un filtro más. */}
      <div className="flex justify-center pb-2.5">
        <select
          value={orden}
          onChange={(e) => onOrden(e.target.value === "antiguos" ? "antiguos" : "recientes")}
          aria-label="Orden de la lista"
          title="«Más antiguos» sube lo que llevas más tiempo sin tocar"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[11.5px] font-medium text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          <option value="recientes">Más recientes primero</option>
          <option value="antiguos">Más antiguos primero</option>
        </select>
      </div>
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
    <ul className="space-y-1.5 px-2 pb-3">
      {conversaciones.map((c) => {
        const activa = c.telefono === seleccionada;
        // «Sin respuesta» solo cuando lleva ≥1 día de clínica: recién
        // enviado un mensaje, el chip sería ruido en cada fila saliente.
        // El filtro «Mías sin respuesta» sí las trae todas.
        const diasSinRespuesta = c.sinRespuestaDesde ? diasDeClinica(c.sinRespuestaDesde) : null;
        const señales =
          c.estadoFlujo != null ||
          c.agenteAlMando ||
          (diasSinRespuesta != null && diasSinRespuesta >= 1) ||
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
                    {/* Fase C: la etiqueta de ESTADO DEL FLUJO — en qué punto
                        está el caso, sin abrir la conversación. Mismas
                        palabras que Seguimiento cuando es una cohorte. */}
                    {c.estadoFlujo && <MarcaFlujo flujo={c.estadoFlujo} />}
                    {c.agenteAlMando && (
                      <Marca tono="accent" Icono={Sparkles}>
                        Agente
                      </Marca>
                    )}
                    {diasSinRespuesta != null && diasSinRespuesta >= 1 && (
                      <Marca tono="neutro" Icono={Hourglass}>
                        {diasSinRespuesta === 1
                          ? "1 día sin respuesta"
                          : `${diasSinRespuesta} días sin respuesta`}
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

/** Días de CLÍNICA desde un instante (§13): la cifra solo cambia a las
 *  00:00, no al segundo — dos recargas seguidas enseñan lo mismo. */
function diasDeClinica(iso: string): number {
  const desde = new Date(`${hoyISO(new Date(iso))}T00:00:00Z`).getTime();
  const hoy = new Date(`${hoyISO()}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((hoy - desde) / 86_400_000));
}

/** La etiqueta de estado del flujo (fase C). Las cohortes, con las MISMAS
 *  palabras que Seguimiento; el resto, lo que el semáforo o la cadencia ya
 *  saben. Tonos: rojo = te espera; ámbar = qué NO hacer; neutro = informa. */
function MarcaFlujo({ flujo }: { flujo: EstadoFlujo }) {
  switch (flujo.clase) {
    case "fuera_de_plazo":
      return <Marca tono="danger" Icono={AlertTriangle}>Fuera de plazo</Marca>;
    case "necesita_respuesta":
      return <Marca tono="danger" Icono={AlertTriangle}>Necesita respuesta</Marca>;
    case "listo_para_cerrar":
      return <Marca tono="accent" Icono={UserCheck}>Listo para cerrar</Marca>;
    case "espera":
      return (
        <Marca tono="warning">
          {flujo.hasta ? `En espera hasta el ${fechaClinica(flujo.hasta)}` : "En espera"}
        </Marca>
      );
    case "asumido":
      return <Marca tono="neutro" Icono={UserCheck}>Lo lleva una persona</Marca>;
    case "automatico":
      return <Marca tono="neutro">Seguimiento automático</Marca>;
  }
}

function Marca({
  tono,
  Icono,
  children,
}: {
  tono: "danger" | "accent" | "warning" | "neutro";
  Icono?: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  const cls =
    tono === "danger"
      ? "border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : tono === "accent"
        ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        : tono === "warning"
          ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
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
