"use client";

// Sprint 8 Bloque D — GlobalHeader con navbar top-level por rol.
// Coord (6): Actuar hoy · Leads · Pacientes · Presupuestos · KPIs · Automatizaciones
// Admin (9): Red · Alertas · Actuar hoy · Leads · Pacientes · Presupuestos · KPIs · Automatizaciones · Ajustes

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { ClinicSelector } from "./ClinicSelector";

type NavItem = { href: string; label: string };

const NAV_COORD: NavItem[] = [
  { href: "/actuar-hoy",      label: "Actuar hoy" },
  { href: "/leads",           label: "Leads" },
  { href: "/pacientes",       label: "Pacientes" },
  { href: "/presupuestos",    label: "Presupuestos" },
  { href: "/kpis",            label: "KPIs" },
  { href: "/automatizaciones",label: "Automatizaciones" },
];

const NAV_ADMIN: NavItem[] = [
  { href: "/red",             label: "Red" },
  { href: "/alertas",         label: "Alertas" },
  { href: "/actuar-hoy",      label: "Actuar hoy" },
  { href: "/leads",           label: "Leads" },
  { href: "/pacientes",       label: "Pacientes" },
  { href: "/presupuestos",    label: "Presupuestos" },
  { href: "/kpis",            label: "KPIs" },
  { href: "/automatizaciones",label: "Automatizaciones" },
  { href: "/ajustes",         label: "Ajustes" },
];

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { session } = useClinic();
  const [loggingOut, setLoggingOut] = useState(false);

  const items = session.rol === "admin" ? NAV_ADMIN : NAV_COORD;
  const rolLabel = session.rol === "admin" ? "Administrador" : "Coordinación";

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("fyllio.selectedClinicaId");
        } catch {}
      }
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      {/* Fila 1: logo + selector + usuario */}
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-3 sm:px-6">
        {/* Logo tipográfico limpio: "Fyllio" con accent celeste sobre los dos últimos caracteres. */}
        <div className="flex items-center font-extrabold tracking-tight text-lg select-none">
          <span className="text-slate-900">Fyll</span>
          <span className="text-sky-500">io</span>
        </div>

        <div className="flex-1 min-w-0">
          <ClinicSelector />
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="hidden sm:block text-right leading-tight">
            <p className="font-semibold text-slate-900 truncate max-w-[220px]">{session.nombre}</p>
            <p className="text-slate-500">{rolLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {loggingOut ? "Saliendo…" : "Salir"}
          </button>
        </div>
      </div>

      {/* Fila 2: navbar top-level */}
      <nav className="border-t border-slate-100 bg-white">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-6 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex items-center gap-1 h-11 whitespace-nowrap">
            {items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`inline-flex items-center h-8 px-3 rounded-full text-xs font-semibold transition-colors ${
                      active
                        ? "bg-sky-600 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </header>
  );
}
