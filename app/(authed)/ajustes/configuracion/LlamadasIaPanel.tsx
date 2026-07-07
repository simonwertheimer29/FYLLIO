"use client";

// Sprint 17 Bloque 7 — panel "Llamadas IA" en /ajustes/configuracion.
// Toggle activación, ventana horaria, mensaje custom, voz, límite/día.

import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { toast } from "sonner";

type Config = {
  activa: boolean;
  horarioInicio: string;
  horarioFin: string;
  limiteDia: number;
  firstMessage: string;
  voicePreference: string;
};

const DEFAULTS: Config = {
  activa: true,
  horarioInicio: "10:00",
  horarioFin: "19:00",
  limiteDia: 50,
  firstMessage: "",
  voicePreference: "",
};

const VOCES = [
  { value: "", label: "Voz por defecto" },
  { value: "es-ES-female-1", label: "Femenina (es-ES)" },
  { value: "es-ES-male-1", label: "Masculina (es-ES)" },
];

export function LlamadasIaPanel({ clinicaId }: { clinicaId: string }) {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [customizado, setCustomizado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/llamadas/config/${clinicaId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => {
        if (cancelled) return;
        setConfig({ ...DEFAULTS, ...(d.config ?? {}) });
        setCustomizado(Boolean(d.customizado));
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar la configuración.");
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
      const res = await fetch(`/api/llamadas/config/${clinicaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      toast.success("Configuración guardada.");
      setCustomizado(true);
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

  return (
    <div className="space-y-3">
      {!customizado && (
        <p className="text-[11px] text-[var(--color-muted)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-xl px-3 py-2">
          Esta clínica está usando la configuración por defecto. Al guardar
          se crea una configuración propia para esta clínica.
        </p>
      )}

      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.activa}
            onChange={(e) => update("activa", e.target.checked)}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              Activar confirmación automática de citas por IA
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Cuando esté activado, se llamará automáticamente cada día a los
              pacientes con cita confirmada en las próximas 23-25 h.
            </p>
          </div>
        </label>
      </Card>

      <Card>
        <p className="text-xs font-medium text-[var(--color-muted)] mb-3">
          Ventana horaria permitida (hora local de la clínica)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={config.horarioInicio}
            onChange={(e) => update("horarioInicio", e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          <span className="text-[var(--color-muted)] text-xs">–</span>
          <input
            type="time"
            value={config.horarioFin}
            onChange={(e) => update("horarioFin", e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mt-2">
          Por defecto 10:00-19:00. Las llamadas fuera de esta ventana se saltan.
        </p>
      </Card>

      <Card>
        <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
          Mensaje personalizado (opcional)
        </label>
        <textarea
          rows={3}
          placeholder="Primer mensaje de la llamada. Si lo dejas vacío se usa el mensaje por defecto."
          value={config.firstMessage}
          onChange={(e) => update("firstMessage", e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </Card>

      <Card>
        <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
          Voz preferida
        </label>
        <select
          value={config.voicePreference}
          onChange={(e) => update("voicePreference", e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        >
          {VOCES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          La voz se aplica a las llamadas de esta clínica. Si la voz seleccionada
          no está disponible, se usa la voz por defecto.
        </p>
      </Card>

      <Card>
        <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
          Límite máximo de llamadas al día
        </label>
        <input
          type="number"
          min={1}
          max={500}
          value={config.limiteDia}
          onChange={(e) => update("limiteDia", Number(e.target.value) || 1)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <p className="text-[10px] text-[var(--color-muted)] mt-1">
          Por defecto 50. Cuando se alcanza, las nuevas llamadas se posponen al
          día siguiente.
        </p>
      </Card>

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
