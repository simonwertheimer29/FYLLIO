"use client";

import { useState, useEffect } from "react";
import type { NoShowsUserSession } from "../../lib/no-shows/types";

// ─── Types + Storage ──────────────────────────────────────────────────────────

type SimpleConfig = {
  recordatoriosOn: boolean;
  objetivoMensual: number; // integer % (e.g. 10 = 10%)
  notificaciones: {
    noShow:          boolean;
    confirmada:      boolean;
    recall:          boolean;
    valoracionBaja:  boolean;
  };
};

const DEFAULT_CONFIG: SimpleConfig = {
  recordatoriosOn: true,
  objetivoMensual: 10,
  notificaciones: {
    noShow:         true,
    confirmada:     false,
    recall:         true,
    valoracionBaja: true,
  },
};

const STORAGE_KEY = "fyllio_noshows_config";
const OBJETIVO_KEY = "fyllio_noshows_objetivo"; // read by HoyView

function loadConfig(): SimpleConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { return DEFAULT_CONFIG; }
}

function saveConfig(cfg: SimpleConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    // sync objetivo key so HoyView reads it correctly
    localStorage.setItem(OBJETIVO_KEY, String(cfg.objetivoMensual));
  } catch { /* silent */ }
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-10 h-5 rounded-full transition-colors relative shrink-0 ${
          checked ? "bg-cyan-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
      <div className="min-w-0">
        <p className="text-sm text-slate-800 leading-tight">{label}</p>
        {description && (
          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{description}</p>
        )}
      </div>
    </label>
  );
}

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
      <div>
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfigView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  const [cfg,   setCfg]   = useState<SimpleConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCfg(loadConfig());
  }, []);

  function update(patch: Partial<SimpleConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function updateNotif(key: keyof SimpleConfig["notificaciones"], value: boolean) {
    setCfg((prev) => ({
      ...prev,
      notificaciones: { ...prev.notificaciones, [key]: value },
    }));
    setSaved(false);
  }

  function handleSave() {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!isManager) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-slate-500">Solo disponible para managers.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">

      {/* ── 1. Recordatorios ── */}
      <SectionCard
        title="Recordatorios"
        subtitle="Activar o desactivar el envío automático de recordatorios preventivos"
      >
        <Toggle
          checked={cfg.recordatoriosOn}
          onChange={(v) => update({ recordatoriosOn: v })}
          label="Recordatorios automáticos"
          description="El sistema detecta el riesgo de cada cita y gestiona los recordatorios sin intervención manual. Desactivar solo en caso de mantenimiento."
        />
      </SectionCard>

      {/* ── 2. Objetivo mensual ── */}
      <SectionCard
        title="Objetivo mensual"
        subtitle="Tasa de no-show objetivo. Se usa en el semáforo de HOY y en las métricas de KPIs."
      >
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-700 shrink-0">Tasa objetivo</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={25}
              step={1}
              value={cfg.objetivoMensual}
              onChange={(e) => update({ objetivoMensual: Number(e.target.value) })}
              className="w-20 rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-bold text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>

        {/* Semáforo preview */}
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-slate-600">
              Verde: tasa &lt; {cfg.objetivoMensual}%
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-600">
              Ámbar: {cfg.objetivoMensual}–{cfg.objetivoMensual + 3}%
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-slate-600">
              Rojo: &gt; {cfg.objetivoMensual + 3}%
            </span>
          </span>
        </div>
      </SectionCard>

      {/* ── 3. Notificaciones ── */}
      <SectionCard
        title="Notificaciones"
        subtitle="Eventos sobre los que quieres recibir alerta en el panel"
      >
        <div className="space-y-4">
          <Toggle
            checked={cfg.notificaciones.noShow}
            onChange={(v) => updateNotif("noShow", v)}
            label="No-show detectado"
            description="Cuando una cita pasa a estado NO_SHOW en Airtable"
          />
          <Toggle
            checked={cfg.notificaciones.confirmada}
            onChange={(v) => updateNotif("confirmada", v)}
            label="Cita confirmada"
            description="Cuando un paciente confirma asistencia"
          />
          <Toggle
            checked={cfg.notificaciones.recall}
            onChange={(v) => updateNotif("recall", v)}
            label="Paciente en recall sin cita"
            description="Paciente en tratamiento activo que lleva más de 3 semanas sin agendar"
          />
          <Toggle
            checked={cfg.notificaciones.valoracionBaja}
            onChange={(v) => updateNotif("valoracionBaja", v)}
            label="Valoración ≤ 2 estrellas"
            description="Nueva reseña con puntuación baja en Google u otras plataformas"
          />
        </div>
      </SectionCard>

      {/* Save button */}
      <div className="flex justify-end pb-4">
        <button
          onClick={handleSave}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition-all ${
            saved
              ? "bg-green-500 text-white scale-95"
              : "bg-cyan-600 text-white hover:bg-cyan-700"
          }`}
        >
          {saved ? "✓ Guardado" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
