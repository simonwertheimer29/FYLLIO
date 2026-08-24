"use client";

// F6 (fase F) — EL CATÁLOGO: qué hace el sistema solo. La regla dictada es
// «DONDE SE VE, NO SE EDITA»: esta ventana enseña qué automatizaciones
// existen, si están encendidas y dónde se ve su resultado — editar es
// NAVEGAR a la configuración del agente, nunca un formulario aquí.
//
// El catálogo es CÓDIGO, no una tabla de reglas: las automatizaciones son
// piezas fijas del producto (el motor de reglas configurables murió en F6 —
// en toda base limpia su tabla estaba vacía, sin UI para crear reglas, y su
// acción de WhatsApp jamás envió nada). El estado del agente por clínica se
// lee de la config real; el resto de piezas están siempre activas y su
// pulso se ve en sus pantallas.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";
import { Card } from "../../components/ui/Card";
import { cargarJSON } from "../../lib/fetch-json";
import {
  Sparkles,
  Repeat,
  Bell,
  Phone,
  MessageCircle,
  ICON_STROKE,
} from "../../components/icons";

type Pieza = {
  Icono: typeof Sparkles;
  nombre: string;
  queHace: string;
  /** Dónde se ve lo que produce. */
  resultado: { label: string; href: string }[];
  /** Dónde se decide cómo se comporta (admin). */
  editaEn: { label: string; href: string } | null;
};

const CATALOGO: Pieza[] = [
  {
    Icono: Sparkles,
    nombre: "Agente conversacional de WhatsApp",
    queHace:
      "Contesta a pacientes y leads, recoge los datos que faltan y deriva a una persona lo que exige criterio. Cada borrador pasa por el juez de reglas duras antes de salir.",
    resultado: [
      { label: "Mensajería", href: "/mensajeria" },
      { label: "Seguimiento", href: "/seguimiento" },
    ],
    editaEn: { label: "Agentes de IA → Conversacional", href: "/agentes/conversacional" },
  },
  {
    Icono: Repeat,
    nombre: "Cadencia de seguimiento de presupuestos",
    queHace:
      "Toca los presupuestos sin respuesta según los días de la secuencia; al agotarse, recomienda llamada y el caso pasa a Seguimiento.",
    resultado: [{ label: "Envíos (la cola del día)", href: "/envios" }],
    editaEn: { label: "Configuración del agente → Cadencias", href: "/agentes/conversacional" },
  },
  {
    Icono: MessageCircle,
    nombre: "Recordatorios de cita y reactivación",
    queHace:
      "Recuerda las citas próximas y reengancha a los rezagados con plantillas aprobadas. Sin plantilla para un hueco, el envío no se genera — se ve el hueco, no un silencio.",
    resultado: [{ label: "Envíos (la cola del día)", href: "/envios" }],
    editaEn: { label: "Configuración del agente → Cadencias", href: "/agentes/conversacional" },
  },
  {
    Icono: Bell,
    nombre: "Alertas a coordinación",
    queHace:
      "Vigila las situaciones que exigen mirada humana (leads sin gestionar, cobros vencidos, presupuestos estancados…) y las cuenta en la campana. Avisar y posponer viven allí.",
    resultado: [{ label: "La campana (arriba en la barra)", href: "/inicio" }],
    editaEn: null,
  },
  {
    Icono: Phone,
    nombre: "Llamadas con IA (voz)",
    queHace:
      "Las llamadas salientes con agente de voz y su registro. Se lanzan y revisan desde su pantalla.",
    resultado: [{ label: "Agentes de IA → Llamadas", href: "/agentes/llamadas" }],
    editaEn: null,
  },
];

export function CatalogoAutomatizaciones({ isAdmin }: { isAdmin: boolean }) {
  const { clinicas } = useClinic();
  // Estado REAL del agente por clínica (solo admin: la config es suya). Un
  // fallo de carga se dice — jamás un «apagado» inventado (§4/§10).
  const [estado, setEstado] = useState<Map<string, boolean> | null>(null);
  const [errorEstado, setErrorEstado] = useState(false);

  useEffect(() => {
    if (!isAdmin || clinicas.length === 0) return;
    let vivo = true;
    void (async () => {
      try {
        // UNA llamada para todas las clínicas; sin fila = apagado (el
        // interruptor es fail-closed desde 025).
        const d = await cargarJSON<{ estados: { clinicaId: string; evaluadorActivo: boolean }[] }>(
          "/api/agente/configuracion?estado=todas",
        );
        if (vivo) setEstado(new Map(d.estados.map((e) => [e.clinicaId, e.evaluadorActivo])));
      } catch {
        // caída-declarada: el estado se marca como no disponible y se dice abajo — el catálogo sigue
        if (vivo) setErrorEstado(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [isAdmin, clinicas]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Qué hace el sistema solo
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          Aquí se ve; se configura en su sitio. Cada pieza dice dónde aparece su
          resultado{isAdmin ? " y dónde se edita" : ""}.
        </p>
      </header>

      {CATALOGO.map((p) => (
        <Card key={p.nombre} padding="none" className="px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-lg bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)]">
              <p.Icono size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-[var(--color-foreground)]">{p.nombre}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{p.queHace}</p>

              {/* El agente es la única pieza con interruptor por clínica. */}
              {p.nombre.startsWith("Agente conversacional") && isAdmin && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {errorEstado ? (
                    <span className="text-[11.5px] text-[var(--color-danger)]">
                      No se pudo leer el estado por clínica.
                    </span>
                  ) : estado == null ? (
                    <span className="h-5 w-40 animate-pulse rounded bg-[var(--color-surface-muted)]" />
                  ) : (
                    clinicas.map((c) => {
                      const on = estado.get(c.id) === true;
                      return (
                        <span
                          key={c.id}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            on
                              ? "border-transparent bg-[var(--color-success-soft)] text-[var(--color-success)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]"
                          }`}
                        >
                          {c.nombre}: {on ? "activo" : "apagado"}
                        </span>
                      );
                    })
                  )}
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="text-[var(--color-muted)]">
                  Se ve en{" "}
                  {p.resultado.map((r, i) => (
                    <span key={r.href}>
                      {i > 0 && " · "}
                      <Link href={r.href} className="font-medium text-[var(--color-accent)] hover:underline">
                        {r.label}
                      </Link>
                    </span>
                  ))}
                </span>
                {isAdmin && p.editaEn && (
                  <span className="text-[var(--color-muted)]">
                    Se edita en{" "}
                    <Link href={p.editaEn.href} className="font-medium text-[var(--color-accent)] hover:underline">
                      {p.editaEn.label}
                    </Link>
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
