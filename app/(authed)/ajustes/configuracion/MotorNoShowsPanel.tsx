"use client";

// Sprint 18 Bloque 8.8 — panel "Motor No-shows" en /ajustes/configuracion.
// Toggles de gating del motor de predicción + salvaguardas. La lógica vive en
// @/lib/no-shows/config (getMotorConfig/setMotorConfig) y @/lib/no-shows/acciones;
// aquí solo editamos los toggles. GET/PUT a /api/no-shows/config/[clinicaId]
// (clinicaId="global" para los defaults globales).

import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { toast } from "sonner";

type Config = {
  activarPrediccion: boolean;
  llamadaIaAuto: boolean;
  plantillasExtraAuto: boolean;
  umbralRiesgoAlto: number;
};

const DEFAULTS: Config = {
  activarPrediccion: true,
  llamadaIaAuto: false,
  plantillasExtraAuto: true,
  umbralRiesgoAlto: 60,
};

export function MotorNoShowsPanel({ clinicaId }: { clinicaId: string }) {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/no-shows/config/${clinicaId}`)
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(
              new Error(
                r.status === 403
                  ? "No tenés permiso para editar esta configuración en este ámbito."
                  : "No se pudo cargar la configuración.",
              ),
            ),
      )
      .then((d) => {
        if (cancelled) return;
        setConfig({ ...DEFAULTS, ...(d ?? {}) });
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message || "No se pudo cargar la configuración.");
          toast.error(e.message || "No se pudo cargar la configuración.");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clinicaId]);

  function update<K extends keyof Config>(k: K, v: Config[K]) {
    setConfig((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/no-shows/config/${clinicaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json().catch(() => null)) as Config | null;
      if (saved) setConfig({ ...DEFAULTS, ...saved });
      toast.success("Configuración guardada.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card padding="none" className="p-8 text-center text-sm text-slate-400 animate-pulse">
        Cargando configuración…
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="none" className="p-6 text-center text-sm text-amber-800 bg-amber-50 border border-amber-200">
        {error}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.activarPrediccion}
            onChange={(e) => update("activarPrediccion", e.target.checked)}
            className="mt-1 accent-emerald-600"
          />
          <div>
            <p className="text-sm font-medium text-slate-800">
              Activar predicción de riesgo
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Evalúa y persiste el riesgo de no-show de las citas próximas. Si se
              desactiva, el motor no calcula scores ni propone acciones.
            </p>
          </div>
        </label>
      </Card>

      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.llamadaIaAuto}
            onChange={(e) => update("llamadaIaAuto", e.target.checked)}
            className="mt-1 accent-violet-600"
          />
          <div>
            <p className="text-sm font-medium text-slate-800">
              Programar llamada IA automática (riesgo alto)
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Cuando una cita supere el umbral de riesgo alto, el motor programará
              una llamada IA saliente de confirmación. Default desactivado.
            </p>
          </div>
        </label>
      </Card>

      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.plantillasExtraAuto}
            onChange={(e) => update("plantillasExtraAuto", e.target.checked)}
            className="mt-1 accent-emerald-600"
          />
          <div>
            <p className="text-sm font-medium text-slate-800">
              Plantillas extra automáticas
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Envía un recordatorio extra por WhatsApp a las citas de riesgo
              medio/alto. Respeta el cooldown de 1 plantilla extra cada 24h.
            </p>
          </div>
        </label>
      </Card>

      <Card>
        <label className="block text-[11px] uppercase font-semibold text-slate-500 tracking-wide mb-1">
          Umbral riesgo alto (0-100)
        </label>
        <input
          type="number"
          min={0}
          max={100}
          value={config.umbralRiesgoAlto}
          onChange={(e) =>
            update(
              "umbralRiesgoAlto",
              Math.max(0, Math.min(100, Number(e.target.value) || 0)),
            )
          }
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm w-32"
        />
        <p className="text-[10px] text-slate-400 mt-1">
          Default 60. Las citas con score superior a este umbral se consideran de
          riesgo alto y activan las acciones más agresivas (llamada IA si está habilitada).
        </p>
      </Card>

      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
        ⚠ La auto-ejecución de acciones desde el cron está pendiente de activación;
        las acciones manuales desde <span className="font-semibold">/no-shows › Motor</span> están
        activas. Salvaguardas activas: opt-out del paciente, cooldown 1 plantilla
        extra/24h, horario laboral, logs en Supabase.
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-sky-600 text-white text-sm font-bold px-4 py-2 hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </div>
  );
}
