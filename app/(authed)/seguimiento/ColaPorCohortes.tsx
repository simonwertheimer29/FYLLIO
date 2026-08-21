"use client";

// P2 (18-08) — LA VISTA DE LAS TRES COHORTES. Lo dictado, punto a punto:
//  · Las cohortes son la división principal; se PLIEGAN — la primera con
//    contenido abierta, las demás cerradas con su número. Tres bloques
//    plegados entran sin scroll.
//  · Card compacta recuperada (tags · importe · teléfono) como GATILLO, y
//    despliegue de la ficha EN EL SITIO. Nada de línea desnuda.
//  · Se responde desde Seguimiento: chat embebido en el despliegue en
//    escritorio; en móvil, botón a la conversación.
//  · Leads/Presupuestos es FILTRO, no división principal.
//
// El criterio vive en el servidor (/api/seguimiento/cola): aquí solo se
// pinta. El filtro de clínica del selector global aplica sobre clinicaId
// CENTRAL, que la ruta ya remapea.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { AccionCard } from "../../components/shared/AccionCard";
import { FichaCasoPanel } from "../../components/agente/FichaCasoPanel";
import { ChatEmbebido } from "./ChatEmbebido";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { eur } from "../../components/shared/Cifra";
import { ChevronDown, ChevronRight, Inbox, Phone, ICON_STROKE } from "../../components/icons";

// Tipos espejo de la ruta (el servidor es la fuente; aquí solo forma).
type Cohorte = "necesita_respuesta" | "listos_para_cerrar" | "fuera_de_plazo";
type Caso = {
  id: string;
  tipo: "lead" | "presupuesto" | "conversacion";
  telefono: string | null;
  nombre: string;
  clinicaId: string | null;
  clinicaNombre: string | null;
  cohorte: Cohorte;
  detalle: string;
  importe: number | null;
  tratamiento: string | null;
  origen: string | null;
  paradoDias: number;
  esperandoMinLaborables: number | null;
  enEspera: boolean;
};

const ORDEN: Cohorte[] = ["necesita_respuesta", "listos_para_cerrar", "fuera_de_plazo"];

const ETIQUETA_COHORTE: Record<Cohorte, { titulo: string; hint: string }> = {
  necesita_respuesta: { titulo: "Necesita respuesta", hint: "Hay alguien esperando una acción tuya" },
  listos_para_cerrar: { titulo: "Listos para cerrar", hint: "El agente terminó — revisa y cierra" },
  fuera_de_plazo: { titulo: "Fuera de plazo", hint: "Le tocaba al equipo y se pasó el plazo" },
};

// Rojo = fallo (fuera de plazo) · ámbar = te toca · azul = cerrar.
const COLOR_COHORTE: Record<Cohorte, string> = {
  necesita_respuesta: "var(--color-warning)",
  listos_para_cerrar: "var(--color-accent)",
  fuera_de_plazo: "var(--color-danger)",
};

const ETIQUETA_DETALLE: Record<string, string> = {
  quebrado: "Necesita criterio",
  paciente_escribio: "Te escribió",
  entregado_urgente: "Urgente del agente",
  entregado_listo: "Caso listo",
  cierre_pendiente: "Cierre pendiente",
  agotado: "Toca llamar",
  nuevo_sin_contactar: "Nuevo sin contactar",
};

const ETIQUETA_TIPO: Record<Caso["tipo"], string> = {
  lead: "Lead",
  presupuesto: "Presupuesto",
  conversacion: "Conversación",
};

function esperaLegible(min: number | null, paradoDias: number): string {
  if (min != null && min > 0) {
    if (min < 60) return `esperándote ${min} min`;
    const h = Math.round(min / 6) / 10;
    return `esperándote ${h % 1 === 0 ? h : h.toFixed(1)} h laborables`;
  }
  if (paradoDias > 0) return `parado ${paradoDias} día${paradoDias !== 1 ? "s" : ""}`;
  return "de hoy";
}

export function ColaPorCohortes() {
  const { selectedClinicaId } = useClinic();
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "lead" | "presupuesto">("todos");
  const [abiertas, setAbiertas] = useState<Set<Cohorte> | null>(null);
  const [desplegado, setDesplegado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await cargarJSON<{ casos: Caso[] }>("/api/seguimiento/cola");
      setCasos(d.casos);
      setError(null);
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10).
      setError(mensajeDeError(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    let v = casos ?? [];
    if (selectedClinicaId) v = v.filter((c) => c.clinicaId === selectedClinicaId);
    if (filtroTipo !== "todos") v = v.filter((c) => c.tipo === filtroTipo);
    return v;
  }, [casos, selectedClinicaId, filtroTipo]);

  const porCohorte = useMemo(() => {
    const m = new Map<Cohorte, Caso[]>(ORDEN.map((c) => [c, []]));
    for (const c of visibles) m.get(c.cohorte)!.push(c);
    // Dentro de cada cohorte, lo más viejo primero: la presión real.
    for (const lista of m.values()) {
      lista.sort((a, b) => (b.esperandoMinLaborables ?? 0) - (a.esperandoMinLaborables ?? 0) || b.paradoDias - a.paradoDias);
    }
    return m;
  }, [visibles]);

  // La primera cohorte CON contenido arranca abierta; las demás, cerradas
  // con su número. El usuario puede abrir/cerrar lo que quiera después.
  useEffect(() => {
    if (casos == null || abiertas != null) return;
    const primera = ORDEN.find((c) => (porCohorte.get(c)?.length ?? 0) > 0);
    setAbiertas(new Set(primera ? [primera] : []));
  }, [casos, abiertas, porCohorte]);

  if (error && casos == null) {
    return <ErrorState title="No se pudo cargar la cola" detail={error} onRetry={cargar} />;
  }
  if (casos == null) return <CardListSkeleton />;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
          No se pudo actualizar — estás viendo los últimos datos cargados.{" "}
          <button onClick={cargar} className="font-medium underline">Reintentar</button>
        </div>
      )}

      {/* Leads/Presupuestos es FILTRO, no división (dictado). */}
      <div className="flex flex-wrap gap-1.5">
        {(["todos", "lead", "presupuesto"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFiltroTipo(t)}
            className={`rounded-full border px-3 py-1 text-[13px] ${
              filtroTipo === t
                ? "border-transparent bg-[var(--color-accent)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            {t === "todos" ? "Todos" : t === "lead" ? "Leads" : "Presupuestos"}
          </button>
        ))}
      </div>

      {visibles.length === 0 && (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title="Nada esperando a una persona ahora mismo"
          hint="Lo que trabaja el agente vive en Mensajería; lo que va a salir hoy, en Envíos."
        />
      )}

      {ORDEN.map((cohorte) => {
        const lista = porCohorte.get(cohorte)!;
        if (visibles.length === 0) return null;
        const abierta = abiertas?.has(cohorte) ?? false;
        return (
          <section key={cohorte} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <button
              onClick={() => {
                const s = new Set(abiertas ?? []);
                if (s.has(cohorte)) s.delete(cohorte);
                else s.add(cohorte);
                setAbiertas(s);
              }}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2">
                {abierta
                  ? <ChevronDown size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" />
                  : <ChevronRight size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" />}
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: COLOR_COHORTE[cohorte] }}
                  aria-hidden
                />
                <span className="font-display text-base font-semibold text-[var(--color-foreground)]">
                  {ETIQUETA_COHORTE[cohorte].titulo}
                </span>
                <span className="hidden text-[13px] text-[var(--color-muted)] sm:inline">
                  · {ETIQUETA_COHORTE[cohorte].hint}
                </span>
              </span>
              <span className="rounded-full bg-[var(--color-surface-muted)] px-2.5 py-0.5 font-display text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
                {lista.length}
              </span>
            </button>

            {abierta && (
              <div className="space-y-3 border-t border-[var(--color-border)] p-4">
                {lista.length === 0 && (
                  <p className="py-2 text-center text-[13px] text-[var(--color-muted)]">
                    Nada aquí ahora mismo.
                  </p>
                )}
                {lista.map((caso) => {
                  const abiertoCaso = desplegado === caso.id;
                  const idDesnudo = caso.id.split(":").slice(1).join(":");
                  return (
                    <div key={caso.id}>
                      <AccionCard
                        borderColor={COLOR_COHORTE[cohorte]}
                        title={caso.nombre}
                        titleRight={
                          caso.importe != null ? (
                            <span className="font-display text-sm font-bold tabular-nums text-[var(--color-foreground)]">
                              {eur(caso.importe)}
                            </span>
                          ) : undefined
                        }
                        tags={[
                          { label: ETIQUETA_DETALLE[caso.detalle] ?? caso.detalle, tone: "sky" as const },
                          { label: ETIQUETA_TIPO[caso.tipo], tone: "neutral" as const },
                          ...(caso.tratamiento ? [{ label: caso.tratamiento, tone: "neutral" as const }] : []),
                          ...(caso.enEspera ? [{ label: "En espera pactada", tone: "rose" as const }] : []),
                        ]}
                        meta={[
                          caso.clinicaNombre,
                          caso.telefono,
                          esperaLegible(caso.esperandoMinLaborables, caso.paradoDias),
                        ].filter(Boolean).join(" · ")}
                        onOpen={() => setDesplegado(abiertoCaso ? null : caso.id)}
                      />
                      {abiertoCaso && caso.telefono && (
                        <div className="mt-2 grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 lg:grid-cols-2">
                          {/* Escritorio: chat embebido. Móvil: botón (dictado). */}
                          <div className="hidden min-h-0 lg:block">
                            <ChatEmbebido telefono={caso.telefono} tipo={caso.tipo} casoId={idDesnudo} />
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2 lg:hidden">
                              <Link
                                href={`/mensajeria?telefono=${encodeURIComponent(caso.telefono)}`}
                                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white"
                              >
                                Abrir la conversación
                              </Link>
                              <a
                                href={`tel:${caso.telefono}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-accent)]"
                              >
                                <Phone size={14} strokeWidth={ICON_STROKE} />
                                Llamar
                              </a>
                            </div>
                            <FichaCasoPanel telefono={caso.telefono} modo="seguimiento" />
                          </div>
                        </div>
                      )}
                      {abiertoCaso && !caso.telefono && (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                          Este caso no tiene teléfono registrado — sin él no hay conversación que abrir.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
