"use client";

// Sprint 16b Bloque 5 — panel "Horario laboral" en /ajustes/configuracion.
// 7 días con toggle activo + inputs hora_inicio + hora_fin por día.
// Se persiste en Configuraciones_Clinica.Categoria=horario_laboral con
// Valor=JSON.

import { useEffect, useState } from "react";
import { Card } from "../../../components/ui/Card";
import { toast } from "sonner";

type HorarioDia = {
  activo: boolean;
  inicio: string;
  fin: string;
};

type Horario = {
  lunes: HorarioDia;
  martes: HorarioDia;
  miercoles: HorarioDia;
  jueves: HorarioDia;
  viernes: HorarioDia;
  sabado: HorarioDia;
  domingo: HorarioDia;
};

const DIAS: Array<{ key: keyof Horario; label: string }> = [
  { key: "lunes", label: "Lunes" },
  { key: "martes", label: "Martes" },
  { key: "miercoles", label: "Miércoles" },
  { key: "jueves", label: "Jueves" },
  { key: "viernes", label: "Viernes" },
  { key: "sabado", label: "Sábado" },
  { key: "domingo", label: "Domingo" },
];

const DEFAULT_HORARIO: Horario = {
  lunes: { activo: true, inicio: "09:00", fin: "20:00" },
  martes: { activo: true, inicio: "09:00", fin: "20:00" },
  miercoles: { activo: true, inicio: "09:00", fin: "20:00" },
  jueves: { activo: true, inicio: "09:00", fin: "20:00" },
  viernes: { activo: true, inicio: "09:00", fin: "20:00" },
  sabado: { activo: false, inicio: "10:00", fin: "14:00" },
  domingo: { activo: false, inicio: "10:00", fin: "14:00" },
};

export function HorarioLaboralPanel({ clinicaId }: { clinicaId: string }) {
  const [horario, setHorario] = useState<Horario>(DEFAULT_HORARIO);
  const [customizado, setCustomizado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/automatizaciones/horario/${clinicaId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => {
        if (cancelled) return;
        setHorario({ ...DEFAULT_HORARIO, ...(d.horario ?? {}) });
        setCustomizado(Boolean(d.customizado));
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar el horario.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clinicaId]);

  function setDia(dia: keyof Horario, patch: Partial<HorarioDia>) {
    setHorario((prev) => ({ ...prev, [dia]: { ...prev[dia], ...patch } }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/automatizaciones/horario/${clinicaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horario }),
      });
      if (!res.ok) throw new Error();
      toast.success("Horario guardado.");
      setCustomizado(true);
    } catch {
      toast.error("No se pudo guardar el horario.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card padding="none" className="p-8 text-center text-sm text-slate-400 animate-pulse">
        Cargando horario…
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {!customizado && (
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          Esta clínica está usando el horario por defecto (lun-vie 09:00-20:00).
          Al guardar se crea un override propio.
        </p>
      )}
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {DIAS.map(({ key, label }) => {
            const d = horario[key];
            return (
              <li key={key} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <label className="inline-flex items-center gap-2 w-32 shrink-0">
                  <input
                    type="checkbox"
                    checked={d.activo}
                    onChange={(e) => setDia(key, { activo: e.target.checked })}
                    className="accent-emerald-600"
                  />
                  <span className="text-sm font-medium text-slate-800">{label}</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={d.inicio}
                    disabled={!d.activo}
                    onChange={(e) => setDia(key, { inicio: e.target.value })}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  <span className="text-slate-400 text-xs">–</span>
                  <input
                    type="time"
                    value={d.fin}
                    disabled={!d.activo}
                    onChange={(e) => setDia(key, { fin: e.target.value })}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
                {!d.activo && (
                  <span className="text-[10px] text-slate-400 ml-auto">cerrado</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-sky-600 text-white text-sm font-bold px-4 py-2 hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar horario"}
        </button>
      </div>
    </div>
  );
}
