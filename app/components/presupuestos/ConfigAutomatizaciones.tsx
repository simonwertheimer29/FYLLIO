"use client";

// app/components/presupuestos/ConfigAutomatizaciones.tsx
// Pantalla de configuración de automatizaciones por clínica.
// Solo visible para manager_general / admin.

import { useState, useEffect } from "react";
import type { UserSession, ConfiguracionAutomatizacion } from "../../lib/presupuestos/types";

interface Props {
  user: UserSession;
}

const DEFAULTS: Omit<ConfiguracionAutomatizacion, "clinica"> = {
  activa: true,
  diasInactividadAlerta: 3,
  diasPortalSinRespuesta: 2,
  diasReactivacion: 90,
};

type ConfigMap = Record<string, ConfiguracionAutomatizacion>;

export default function ConfigAutomatizaciones({ user }: Props) {
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  useEffect(() => {
    async function fetchConfigs() {
      setLoading(true);
      try {
        const res = await fetch("/api/automatizaciones/configuracion");
        const d = await res.json();
        const map: ConfigMap = {};
        if (d.configuraciones) {
          for (const c of d.configuraciones as ConfiguracionAutomatizacion[]) {
            map[c.clinica] = c;
          }
        } else if (d.configuracion) {
          const c = d.configuracion as ConfiguracionAutomatizacion;
          map[c.clinica] = c;
        }
        // If empty, we'll show after fetching clinics
        setConfigs(map);
      } catch {
        setConfigs({});
      } finally {
        setLoading(false);
      }
    }
    fetchConfigs();
  }, []);

  // Fetch clinic list if no configs yet
  const [clinicas, setClinicas] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => { setClinicas(d.clinicas ?? []); })
      .catch(() => {});
  }, []);

  // Merge: ensure every known clinic has a config entry
  const allClinicas = Array.from(
    new Set([...Object.keys(configs), ...clinicas])
  ).sort();

  function getConfig(clinica: string): ConfiguracionAutomatizacion {
    return configs[clinica] ?? { clinica, ...DEFAULTS };
  }

  function updateConfig(clinica: string, patch: Partial<Omit<ConfiguracionAutomatizacion, "clinica">>) {
    setConfigs((prev) => ({
      ...prev,
      [clinica]: { ...getConfig(clinica), ...patch },
    }));
  }

  async function saveConfig(clinica: string) {
    setSaving((p) => ({ ...p, [clinica]: true }));
    try {
      const cfg = getConfig(clinica);
      await fetch("/api/automatizaciones/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      setSaved((p) => ({ ...p, [clinica]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [clinica]: false })), 2000);
    } catch {
      // silent
    } finally {
      setSaving((p) => ({ ...p, [clinica]: false }));
    }
  }

  async function seedDemo() {
    setSeedLoading(true);
    try {
      await fetch("/api/automatizaciones/seed-demo", { method: "POST" });
      setSeedDone(true);
      setTimeout(() => setSeedDone(false), 3000);
    } catch {
      // silent
    } finally {
      setSeedLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200 p-5 bg-white">
            <div className="h-4 w-40 bg-slate-200 rounded mb-4" />
            <div className="space-y-3">
              <div className="h-3 w-64 bg-slate-100 rounded" />
              <div className="h-3 w-56 bg-slate-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Configuración de Automatizaciones</h2>
          <p className="text-xs text-slate-500 mt-0.5">Configura los umbrales de activación por clínica</p>
        </div>
        {/* Seed demo button */}
        <button
          onClick={seedDemo}
          disabled={seedLoading}
          className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
            seedDone
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
          }`}
        >
          {seedLoading ? "Cargando…" : seedDone ? "✓ Demo cargada" : "Cargar demo (3 mensajes)"}
        </button>
      </div>

      {allClinicas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-sm">No hay clínicas configuradas todavía.</p>
        </div>
      )}

      {allClinicas.map((clinica) => {
        const cfg = getConfig(clinica);
        const isSaving = saving[clinica] ?? false;
        const isSaved = saved[clinica] ?? false;

        return (
          <div key={clinica} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            {/* Clinic header + toggle */}
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-slate-900">{clinica}</h3>
              <button
                onClick={() => updateConfig(clinica, { activa: !cfg.activa })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  cfg.activa ? "bg-violet-600" : "bg-slate-200"
                }`}
                title={cfg.activa ? "Desactivar automatizaciones" : "Activar automatizaciones"}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    cfg.activa ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Threshold fields */}
            <div className={`space-y-3 ${!cfg.activa ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-slate-600 flex-1">
                  Días sin actividad para alertar
                  <span className="text-[10px] text-slate-400 block">Evento: presupuesto inactivo</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={cfg.diasInactividadAlerta}
                  onChange={(e) => updateConfig(clinica, { diasInactividadAlerta: Number(e.target.value) })}
                  className="w-16 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-slate-600 flex-1">
                  Días portal sin respuesta
                  <span className="text-[10px] text-slate-400 block">Evento: portal visto sin respuesta</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={cfg.diasPortalSinRespuesta}
                  onChange={(e) => updateConfig(clinica, { diasPortalSinRespuesta: Number(e.target.value) })}
                  className="w-16 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-slate-600 flex-1">
                  Días para reactivación de perdidos
                  <span className="text-[10px] text-slate-400 block">Evento: reactivación programada</span>
                </label>
                <input
                  type="number"
                  min={30}
                  max={365}
                  value={cfg.diasReactivacion}
                  onChange={(e) => updateConfig(clinica, { diasReactivacion: Number(e.target.value) })}
                  className="w-16 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>

            {/* Save button */}
            <div className="flex justify-end">
              <button
                onClick={() => saveConfig(clinica)}
                disabled={isSaving}
                className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                  isSaved
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-violet-600 text-white hover:bg-violet-700"
                }`}
              >
                {isSaving ? "Guardando…" : isSaved ? "✓ Guardado" : "Guardar cambios"}
              </button>
            </div>
          </div>
        );
      })}

      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-500 mb-1">Sobre las automatizaciones</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Las secuencias se procesan automáticamente cuando visitas la vista de Tareas. Los mensajes generados aparecen en la cola para que los revises antes de enviar. Nunca se envía nada sin tu aprobación.
        </p>
      </div>
    </div>
  );
}
