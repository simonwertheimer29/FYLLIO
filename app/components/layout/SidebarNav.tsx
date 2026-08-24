"use client";

// FASE F — LA BARRA VERTICAL (piloto, 23-08). Estilo consola: nombres
// visibles, tres familias separadas, y las SUBPESTAÑAS desplegadas DENTRO de
// la lista, indentadas bajo su ventana (nada de una segunda barra dentro de
// la pantalla — criterio dictado). Arriba: logo, selector de clínica y
// campana. Abajo: usuario y salir.
//
// PILOTO: la monta AppShell solo en Seguimiento/Envíos — se mira en una
// pantalla antes de tocar diez (condición dictada). Los ítems ya son la
// ESTRUCTURA NUEVA de la fase F, apuntando a las rutas de HOY: la barra es
// puro nav — agrupa visualmente sin esperar a los renombres de F1+.
//
// Compactar a iconos o botón ancha/compacta: decisión POSPUESTA a después de
// verla (dictado). Móvil: AppShell la sirve como drawer.

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { ClinicSelector } from "./ClinicSelector";
import { CampanaAlertas } from "./CampanaAlertas";
import { ThemeToggle } from "./ThemeToggle";
import {
  ChevronDown,
  ChevronRight,
  Home,
  MessageCircle,
  ClipboardList,
  TrendingUp,
  FileSpreadsheet,
  Users,
  Repeat,
  Sparkles,
  BarChart3,
  Settings,
  ICON_STROKE,
} from "../icons";

type Item = {
  label: string;
  href: string;
  Icono: typeof Home;
  /** Sub-vistas indentadas (dos caras del mismo objeto, PLAN §7). */
  hijos?: { label: string; href: string }[];
  soloAdmin?: boolean;
};

// El orden dictado (§7 de la fase F): diario → flujo → configuración.
const ITEMS: Item[] = [
  { label: "Inicio", href: "/inicio", Icono: Home }, // F1: abierta a coordinación — su aterrizaje
  { label: "Mensajería", href: "/mensajeria", Icono: MessageCircle },
  {
    label: "Seguimiento",
    href: "/seguimiento",
    Icono: ClipboardList,
    hijos: [
      { label: "Pendientes", href: "/seguimiento" },
      { label: "Envíos", href: "/envios" },
      // F4b: la COLA de cobros (Actuar) cuelga aquí temporalmente — F5 la
      // funde en las cohortes y esta entrada muere. Sin ella, al llevarse
      // Tablas el Registro, la cola quedaba inalcanzable desde la barra.
      { label: "Cobros", href: "/cobros" },
    ],
  },
  {
    label: "Pipeline",
    href: "/pipeline/leads",
    Icono: TrendingUp,
    hijos: [
      { label: "Leads", href: "/pipeline/leads" },
      { label: "Presupuestos", href: "/pipeline/presupuestos" },
    ],
  },
  {
    label: "Tablas",
    href: "/tablas/leads",
    Icono: FileSpreadsheet,
    hijos: [
      { label: "Leads", href: "/tablas/leads" },
      { label: "Presupuestos", href: "/tablas/presupuestos" },
      { label: "Cobros", href: "/tablas/cobros" },
    ],
  },
  { label: "Pacientes", href: "/pacientes", Icono: Users },
  { label: "Automatizaciones", href: "/automatizaciones", Icono: Repeat },
  {
    label: "Agentes de IA",
    href: "/agentes/conversacional",
    Icono: Sparkles,
    hijos: [
      { label: "Conversacional", href: "/agentes/conversacional" },
      { label: "Llamadas", href: "/agentes/llamadas" },
    ],
  },
  {
    label: "Analíticas",
    href: "/analiticas/kpis",
    Icono: BarChart3,
    hijos: [
      { label: "KPIs", href: "/analiticas/kpis" },
      { label: "Informes", href: "/analiticas/informes" },
    ],
  },
  { label: "Ajustes", href: "/ajustes", Icono: Settings, soloAdmin: true },
];

function rutaDe(href: string): { path: string; query: URLSearchParams } {
  const [path, q] = href.split("?");
  return { path, query: new URLSearchParams(q ?? "") };
}

export function SidebarNav({ onNavegar }: { onNavegar?: () => void }) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useClinic();
  const esAdmin = session.rol === "admin";
  const [loggingOut, setLoggingOut] = useState(false);
  // Grupos abiertos a mano; el del pathname activo se abre solo.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const items = ITEMS.filter((i) => !i.soloAdmin || esAdmin);

  /** Activo EXACTO de una sub-vista: ruta + (si el href lleva query) que los
   *  params actuales la incluyan — /presupuestos?vista=maxima no debe
   *  encender también a /presupuestos a secas, ni al revés. */
  function activo(href: string, exacto = false): boolean {
    const { path, query } = rutaDe(href);
    const enRuta = exacto ? pathname === path : pathname === path || pathname.startsWith(path + "/");
    if (!enRuta) return false;
    for (const [k, v] of query.entries()) {
      if (params.get(k) !== v) return false;
    }
    return true;
  }

  function grupoActivo(item: Item): boolean {
    return activo(item.href) || (item.hijos ?? []).some((h) => activo(h.href));
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      try {
        localStorage.removeItem("fyllio.selectedClinicaId");
      } catch {
        // caída-declarada: localStorage puede no estar (navegación privada) — el logout sigue
      }
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      {/* ── Arriba: logo · campana ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <Link href="/" className="flex items-center gap-2 select-none" aria-label="Fyllio">
          <Image src="/isotipo.png" alt="Fyllio" width={28} height={28} priority className="h-7 w-7" />
          <span className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">Fyllio</span>
        </Link>
        {/* F3: la CAMPANA — las alertas interrumpen, no se visitan. */}
        {esAdmin && <CampanaAlertas />}
      </div>
      <div className="px-3 pt-3">
        <ClinicSelector />
      </div>

      {/* ── La lista ───────────────────────────────────────────────────── */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-1.5">
          {items.map((item) => {
            const conHijos = (item.hijos?.length ?? 0) > 0;
            const enGrupo = grupoActivo(item);
            const desplegado = conHijos && (enGrupo || abiertos[item.label] === true) && abiertos[item.label] !== false;
            const activoSolo = !conHijos && activo(item.href);
            return (
              <li key={item.label}>
                <div className="flex items-center">
                  <Link
                    href={item.href}
                    onClick={onNavegar}
                    className={`font-display flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${
                      activoSolo || (conHijos && enGrupo && !desplegado)
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                    }`}
                  >
                    <item.Icono size={16} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                  {conHijos && (
                    <button
                      type="button"
                      aria-label={`${desplegado ? "Plegar" : "Desplegar"} ${item.label}`}
                      onClick={() => setAbiertos((a) => ({ ...a, [item.label]: !desplegado }))}
                      className="rounded-md p-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    >
                      {desplegado ? (
                        <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      ) : (
                        <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      )}
                    </button>
                  )}
                </div>
                {desplegado && (
                  <ul className="mt-1 space-y-0.5 border-l border-[var(--color-border)] pl-2 ml-[1.4rem]">
                    {item.hijos!.map((h) => (
                      <li key={h.label}>
                        <Link
                          href={h.href}
                          onClick={onNavegar}
                          className={`block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                            activo(h.href, true)
                              ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                              : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
                          }`}
                        >
                          {h.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Abajo: usuario · tema · salir ──────────────────────────────── */}
      <div className="border-t border-[var(--color-border)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 leading-tight">
            <p className="font-display truncate text-[12.5px] font-semibold text-[var(--color-foreground)]">
              {session.nombre}
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {esAdmin ? "Administrador" : "Coordinación"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              {loggingOut ? "…" : "Salir"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
