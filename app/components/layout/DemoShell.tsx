"use client";

import { ReactNode } from "react";

export type DemoSectionKey = "HOY" | "RULES" | "AGENDA" | "ACTIONS" | "IMPACT" | "WAITLIST" | "MENSAJES" | "ESTADISTICAS" | "PRESUPUESTOS";

type Section = {
  key: DemoSectionKey;
  label: string;
  icon: ReactNode;
};

const IconBox = ({ children }: { children: ReactNode }) => (
  <div className="h-10 w-10 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white font-bold">
    {children}
  </div>
);

export default function DemoShell({
  section,
  onChangeSection,
  headerRight,
  children,
}: {
  section: DemoSectionKey;
  onChangeSection: (k: DemoSectionKey) => void;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const sections: Section[] = [
    { key: "HOY", label: "Hoy", icon: <IconBox>☀</IconBox> },
    { key: "PRESUPUESTOS", label: "Presupuestos", icon: <IconBox>€</IconBox> },
    { key: "RULES", label: "Reglas", icon: <IconBox>R</IconBox> },
    { key: "AGENDA", label: "Agenda", icon: <IconBox>A</IconBox> },
    { key: "ACTIONS", label: "Acciones", icon: <IconBox>✓</IconBox> },
    { key: "IMPACT", label: "Impacto", icon: <IconBox>$</IconBox> },
    { key: "WAITLIST", label: "Lista de espera", icon: <IconBox>⏳</IconBox> },
    { key: "MENSAJES", label: "Mensajes", icon: <IconBox>💬</IconBox> },
    { key: "ESTADISTICAS", label: "Estadísticas", icon: <IconBox>📊</IconBox> },
  ];

  return (
    <div className="min-h-[100svh] bg-slate-50">
      <div className="flex min-h-[100svh]">
        <aside className="w-[92px] shrink-0 bg-gradient-to-b from-sky-600 to-blue-700 border-r border-white/10 sticky top-0 h-[100svh] overflow-y-auto">
          <div className="h-[72px] flex items-center justify-center">
            <div className="h-11 w-11 rounded-2xl bg-white/20 border border-white/25 flex items-center justify-center text-white font-extrabold">
              F
            </div>
          </div>

          <div className="px-3 pb-6 pt-2 space-y-3">
            {sections.map((s) => {
              const active = s.key === section;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onChangeSection(s.key)}
                  className={[
                    "w-full rounded-3xl p-2 transition",
                    active ? "bg-white/18 border border-white/25" : "hover:bg-white/12",
                  ].join(" ")}
                  title={s.label}
                  aria-label={s.label}
                >
                  <div className="flex flex-col items-center gap-2">
                    {s.icon}
                    <span className={["text-[11px] font-semibold", active ? "text-white" : "text-white/80"].join(" ")}>
                      {s.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="h-[72px] flex items-center justify-between px-6 bg-white border-b border-slate-200">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Fyllio · Simulación</p>
              <p className="text-xs text-slate-500">Reglas → Agenda → Tiempo disponible → Acciones</p>
            </div>
            <div className="flex items-center gap-3">{headerRight}</div>
          </div>

          <main className="p-6">
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
