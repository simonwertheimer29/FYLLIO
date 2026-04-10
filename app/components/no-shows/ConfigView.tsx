"use client";

import { useState, useEffect } from "react";
import type { NoShowsUserSession } from "../../lib/no-shows/types";
import {
  HIGH_RISK_TREATMENTS,
  LOW_RISK_TREATMENTS,
  RISK_HIGH,
  RISK_MEDIUM,
} from "../../lib/no-shows/score";

// ─── Types + Storage ──────────────────────────────────────────────────────────

type LocalConfig = {
  riskHighThreshold: number;
  riskMediumThreshold: number;
  highRiskTreatments: string[];
  lowRiskTreatments: string[];
  whatsappTemplates: { high: string; medium: string; low: string };
  reminderRules: { send72h: boolean; send48h: boolean; send24h: boolean; sendHour: number };
  tasaPreFyllio: number; // %
};

const DEFAULT_CONFIG: LocalConfig = {
  riskHighThreshold: RISK_HIGH,
  riskMediumThreshold: RISK_MEDIUM,
  highRiskTreatments: [...HIGH_RISK_TREATMENTS],
  lowRiskTreatments: [...LOW_RISK_TREATMENTS],
  whatsappTemplates: {
    high: "Hola {nombre}, te recordamos tu cita de {tratamiento} mañana a las {hora}. Por favor confirma respondiendo SÍ. Sin respuesta, llamaremos para asegurar tu plaza.",
    medium: "Hola {nombre}, tu cita de {tratamiento} es mañana a las {hora}. ¡Te esperamos! Confirma respondiendo SÍ.",
    low: "Hola {nombre}, recordatorio de tu cita de {tratamiento} mañana a las {hora}. ¡Hasta pronto!",
  },
  reminderRules: { send72h: true, send48h: true, send24h: true, sendHour: 10 },
  tasaPreFyllio: 15,
};

const STORAGE_KEY = "fyllio_noshows_config";

function loadConfig(): LocalConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { return DEFAULT_CONFIG; }
}

function saveConfig(cfg: LocalConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* silent */ }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function TreatmentChips({
  label,
  items,
  onAdd,
  onRemove,
  chipColor,
}: {
  label: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  chipColor: "red" | "green";
}) {
  const [input, setInput] = useState("");

  function handleAdd() {
    const v = input.trim().toLowerCase();
    if (!v || items.includes(v)) { setInput(""); return; }
    onAdd(v);
    setInput("");
  }

  const chipCls = chipColor === "red"
    ? "bg-red-50 text-red-700 border border-red-200"
    : "bg-green-50 text-green-700 border border-green-200";

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {items.map((item) => (
          <span key={item} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${chipCls}`}>
            {item}
            <button
              onClick={() => onRemove(item)}
              className="leading-none opacity-60 hover:opacity-100 transition-opacity ml-0.5"
              title="Eliminar"
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-slate-400 italic">Sin tratamientos</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="Añadir tratamiento..."
          className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-300 text-slate-700"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 rounded-xl bg-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConfigView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [cfg, setCfg] = useState<LocalConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCfg(loadConfig());
  }, []);

  function update(patch: Partial<LocalConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function handleSave() {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleReset() {
    setCfg(DEFAULT_CONFIG);
    saveConfig(DEFAULT_CONFIG);
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

      {/* ── 1. Umbrales de riesgo ── */}
      <SectionCard title="Umbrales de riesgo" subtitle="Puntuación mínima para clasificar una cita como riesgo alto o medio">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-red-700 block mb-1">
              ALTO (≥ N puntos)
            </label>
            <input
              type="number"
              min={31}
              max={99}
              value={cfg.riskHighThreshold}
              onChange={(e) => update({ riskHighThreshold: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-amber-700 block mb-1">
              MEDIO (≥ N puntos)
            </label>
            <input
              type="number"
              min={10}
              max={cfg.riskHighThreshold - 1}
              value={cfg.riskMediumThreshold}
              onChange={(e) => update({ riskMediumThreshold: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
        </div>
        <div className="flex gap-2 text-xs text-slate-400">
          <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">ALTO ≥ {cfg.riskHighThreshold}</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-semibold">MEDIO {cfg.riskMediumThreshold}–{cfg.riskHighThreshold - 1}</span>
          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-semibold">BAJO &lt; {cfg.riskMediumThreshold}</span>
        </div>
      </SectionCard>

      {/* ── 2. Tratamientos de riesgo ── */}
      <SectionCard title="Tratamientos de riesgo" subtitle="Clasificación que afecta al factor tratamiento en el score">
        <TreatmentChips
          label="Riesgo alto (revisión, limpieza…)"
          items={cfg.highRiskTreatments}
          onAdd={(v) => update({ highRiskTreatments: [...cfg.highRiskTreatments, v] })}
          onRemove={(v) => update({ highRiskTreatments: cfg.highRiskTreatments.filter((t) => t !== v) })}
          chipColor="red"
        />
        <TreatmentChips
          label="Riesgo bajo (implante, ortodoncia…)"
          items={cfg.lowRiskTreatments}
          onAdd={(v) => update({ lowRiskTreatments: [...cfg.lowRiskTreatments, v] })}
          onRemove={(v) => update({ lowRiskTreatments: cfg.lowRiskTreatments.filter((t) => t !== v) })}
          chipColor="green"
        />
      </SectionCard>

      {/* ── 3. Plantillas WhatsApp ── */}
      <SectionCard title="Plantillas WhatsApp" subtitle="Variables disponibles: {nombre}, {hora}, {tratamiento}">
        {(["high", "medium", "low"] as const).map((level) => {
          const labelMap = { high: "🔴 Riesgo ALTO", medium: "🟡 Riesgo MEDIO", low: "🟢 Riesgo BAJO" };
          return (
            <div key={level}>
              <label className="text-xs font-semibold text-slate-600 block mb-1">{labelMap[level]}</label>
              <textarea
                rows={3}
                value={cfg.whatsappTemplates[level]}
                onChange={(e) =>
                  update({
                    whatsappTemplates: { ...cfg.whatsappTemplates, [level]: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-cyan-300"
              />
              {/* Variable preview */}
              <p className="text-[10px] text-slate-400 mt-1">
                {cfg.whatsappTemplates[level]
                  .replace("{nombre}", "María")
                  .replace("{hora}", "10:30")
                  .replace("{tratamiento}", "ortodoncia")}
              </p>
            </div>
          );
        })}
      </SectionCard>

      {/* ── 4. Reglas de recordatorio ── */}
      <SectionCard title="Reglas de recordatorio" subtitle="Cuándo enviar recordatorios automáticos">
        <div className="space-y-2">
          {(
            [
              { key: "send72h", label: "72h antes", suffix: "(solo para riesgo ALTO)" },
              { key: "send48h", label: "48h antes", suffix: "" },
              { key: "send24h", label: "24h antes", suffix: "" },
            ] as { key: keyof typeof cfg.reminderRules; label: string; suffix: string }[]
          ).map(({ key, label, suffix }) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={cfg.reminderRules[key] as boolean}
                onClick={() =>
                  update({
                    reminderRules: {
                      ...cfg.reminderRules,
                      [key]: !(cfg.reminderRules[key] as boolean),
                    },
                  })
                }
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                  cfg.reminderRules[key] ? "bg-cyan-500" : "bg-slate-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    cfg.reminderRules[key] ? "translate-x-5" : ""
                  }`}
                />
              </button>
              <span className="text-sm text-slate-700">{label}</span>
              {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-700 shrink-0">Hora de envío</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={7}
              max={20}
              value={cfg.reminderRules.sendHour}
              onChange={(e) =>
                update({ reminderRules: { ...cfg.reminderRules, sendHour: Number(e.target.value) } })
              }
              className="w-16 rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-bold text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <span className="text-sm text-slate-400">:00</span>
          </div>
        </div>
      </SectionCard>

      {/* ── 5. ROI — Tasa pre-Fyllio ── */}
      <SectionCard title="Cálculo de ROI" subtitle="Tasa histórica de no-shows antes de usar Fyllio (para proyección de ingresos recuperados en KPIs)">
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-700 shrink-0">Tasa pre-Fyllio</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={50}
              step={0.5}
              value={cfg.tasaPreFyllio}
              onChange={(e) => update({ tasaPreFyllio: Number(e.target.value) })}
              className="w-20 rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-bold text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <span className="text-sm text-slate-400">%</span>
          </div>
          <p className="text-xs text-slate-400">
            Por defecto: 15%
          </p>
        </div>
      </SectionCard>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <button
          onClick={handleReset}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2"
        >
          Restablecer valores por defecto
        </button>
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
