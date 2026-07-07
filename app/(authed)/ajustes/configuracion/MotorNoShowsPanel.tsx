"use client";

// Sprint 18 Bloque 8.8 — panel "Motor No-shows" en /ajustes/configuracion.
// Toggles de gating del motor de predicción + salvaguardas. La lógica vive en
// @/lib/no-shows/config (getMotorConfig/setMotorConfig) y @/lib/no-shows/acciones;
// aquí solo editamos los toggles. GET/PUT a /api/no-shows/config/[clinicaId]
// (clinicaId="global" para los defaults globales).

import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { AlertTriangle, ICON_STROKE } from "../../../components/icons";
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
      <Card padding="none" className="p-8 text-center text-sm text-[var(--color-muted)] animate-pulse">
        Cargando configuración…
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="none" className="p-6 text-center text-sm text-amber-800 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25">
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
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              Activar predicción de riesgo
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
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
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              Programar llamada IA automática (riesgo alto)
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Cuando una cita supere el umbral de riesgo alto, el motor programará
              una llamada IA saliente de confirmación. Desactivado por defecto.
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
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              Plantillas extra automáticas
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Envía un recordatorio extra por WhatsApp a las citas de riesgo
              medio/alto. Respeta el límite de 1 plantilla extra cada 24 h.
            </p>
          </div>
        </label>
      </Card>

      <Card>
        <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
          Umbral de riesgo alto (0-100)
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
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          Por defecto 60. Las citas con score superior a este umbral se consideran de
          riesgo alto y activan las acciones más agresivas (llamada IA si está habilitada).
        </p>
      </Card>

      <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 rounded-xl px-3 py-2 leading-relaxed">
        <AlertTriangle size={14} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          La ejecución automática de acciones está pendiente de activación;
          las acciones manuales desde <span className="font-semibold">No-shows › Motor</span> están
          activas. Salvaguardas activas: opt-out del paciente, límite de 1 plantilla
          extra cada 24 h, horario laboral y registro de cada acción.
        </span>
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold px-4 py-2 hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </div>
  );
}
