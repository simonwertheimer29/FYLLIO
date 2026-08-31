"use client";

// app/components/ajustes/ObjetivosMesPanel.tsx
//
// El editor de objetivos mensuales por clínica. **Es el único que hay en toda la
// app**: si esto se rompe, no existe otro sitio donde poner un objetivo.
//
// Vivía dentro de `ConfigAutomatizaciones` como «Section ②», en la pestaña
// «Reglas y objetivos» de /automatizaciones — un editor de configuración
// escondido detrás de una pestaña que no habla de configuración. Sale aquí
// entero, sin cambiar lo que hace, como primer paso de la fusión de /ajustes y
// /automatizaciones (MEJORAS 13). Se mueve ANTES que nada precisamente por ser
// único.
//
// Lo que SÍ cambia, porque estaba mal: el botón decía «Guardado» pasara lo que
// pasara. `saveObjetivo` llamaba a `fetch` sin mirar la respuesta, así que un
// 500 o un 403 pintaban el tick verde igual que un guardado bueno, y el objetivo
// se quedaba además en el estado local — la pantalla enseñaba un número que no
// estaba en la base hasta que alguien recargara (§1: nada confirma éxito antes
// de estar persistido).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "../ui/Feedback";
import { Check, ICON_STROKE } from "../icons";
import { mesISO } from "../../lib/time";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";

export function ObjetivosMesPanel() {
  const [objetivos, setObjetivos] = useState<Record<string, number>>({});
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [aceptadosMTD, setAceptadosMTD] = useState<Record<string, number>>({});
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mesMTD = mesISO();

  // La regla del servidor: el objetivo del mes en curso solo se puede fijar
  // hasta el día 5 (`/api/presupuestos/objetivos`, POST). La pantalla no la
  // contaba, así que a partir del día 6 se podía escribir un número, pulsar
  // Guardar, y ver «Guardado» — el servidor había dicho 403 y nadie lo miraba.
  // Ahora se dice antes de que alguien lo intente. Se decide con la misma
  // fuente que el servidor (el día del mes), no con una copia de la fecha.
  const diaDelMes = new Date().getDate();
  const cerrado = diaDelMes > 5;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [objData, kanbanData, clinicasData] = await Promise.all([
        cargarJSON<{ objetivos: { clinica: string; objetivo_aceptados: number }[] }>(
          `/api/presupuestos/objetivos?mes=${mesMTD}`,
          { validar: traeLista("objetivos") },
        ),
        cargarJSON<{
          presupuestos: { estado: string; fechaPresupuesto?: string; clinica?: string }[];
        }>(`/api/presupuestos/kanban`, { validar: traeLista("presupuestos") }),
        cargarJSON<{ clinicas: string[] }>("/api/presupuestos/clinicas", {
          validar: traeLista("clinicas"),
        }),
      ]);
      const objMap: Record<string, number> = {};
      for (const o of objData.objetivos) {
        objMap[o.clinica] = o.objetivo_aceptados;
      }
      setObjetivos(objMap);

      const aceptMap: Record<string, number> = {};
      for (const p of kanbanData.presupuestos) {
        if (p.estado === "ACEPTADO" && p.fechaPresupuesto?.startsWith(mesMTD)) {
          const key = p.clinica ?? "Sin clínica";
          aceptMap[key] = (aceptMap[key] ?? 0) + 1;
        }
      }
      setAceptadosMTD(aceptMap);
      setClinicas(clinicasData.clinicas);
    } catch (e) {
      setLoadError(mensajeDeError(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const allClinicas = Array.from(new Set([...Object.keys(objetivos), ...clinicas])).sort();

  async function saveObjetivo(clinica: string) {
    const rawVal = editVals[clinica];
    const val = rawVal !== undefined ? Number(rawVal) : objetivos[clinica];
    if (!val) return;
    setSaving((p) => ({ ...p, [clinica]: true }));
    try {
      // Antes esto era un `fetch` a pelo cuyo resultado nadie miraba: el tick
      // verde salía igual si el servidor había dicho que no. `cargarJSON` lanza
      // ante cualquier fallo, así que el «Guardado» solo aparece si lo está.
      await cargarJSON(`/api/presupuestos/objetivos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinica, mes: mesMTD, objetivo_aceptados: val }),
      });
      setObjetivos((prev) => ({ ...prev, [clinica]: val }));
      setSaved((p) => ({ ...p, [clinica]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [clinica]: false })), 2000);
    } catch (e) {
      // Y el valor NO se queda en pantalla como si estuviera puesto: se
      // devuelve el campo a lo que hay en la base, para que nadie se vaya
      // creyendo que fijó un objetivo que no existe.
      setEditVals((prev) => {
        const { [clinica]: _, ...resto } = prev;
        return resto;
      });
      toast.error(`No se pudo guardar el objetivo de ${clinica}. ${mensajeDeError(e)}`);
    } finally {
      setSaving((p) => ({ ...p, [clinica]: false }));
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        detail={`Los objetivos del mes no están disponibles ahora mismo. ${loadError}`}
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          Objetivo mensual
        </h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Define cuántos presupuestos deberían aceptarse este mes por clínica
        </p>
      </div>

      {cerrado && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
          <p className="text-sm font-semibold text-[var(--color-foreground)]">
            El objetivo de este mes ya está cerrado
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Se puede fijar hasta el día 5 de cada mes. Después queda fijo, para que la cifra
            contra la que se mide el mes no cambie a mitad de camino. El del mes que viene se
            podrá poner a partir del día 1.
          </p>
        </div>
      )}

      {allClinicas.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center">
          <p className="text-[var(--color-muted)] text-sm">No hay clínicas disponibles todavía.</p>
        </div>
      )}

      <div className="space-y-4">
        {allClinicas.map((clinica) => {
          const obj = objetivos[clinica];
          const actual = aceptadosMTD[clinica] ?? 0;
          const pct = obj ? Math.min(100, Math.round((actual / obj) * 100)) : 0;
          const isSaving = saving[clinica] ?? false;
          const isSaved = saved[clinica] ?? false;
          const editVal = editVals[clinica] ?? (obj != null ? String(obj) : "");
          return (
            <div
              key={clinica}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <h4 className="font-semibold text-[var(--color-foreground)] flex-1">{clinica}</h4>
                {obj != null && (
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      actual >= obj
                        ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : pct >= 70
                          ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                    }`}
                  >
                    {actual}/{obj}
                  </span>
                )}
              </div>

              {obj != null && (
                <div className="mb-4">
                  <div className="h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        actual >= obj
                          ? "bg-emerald-500"
                          : pct >= 70
                            ? "bg-amber-400"
                            : "bg-rose-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)] mt-1">
                    {pct}% del objetivo este mes
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-[var(--color-muted)]">Objetivo de aceptados</label>
                  <input
                    type="number"
                    min={1}
                    value={editVal}
                    disabled={cerrado}
                    onChange={(e) =>
                      setEditVals((prev) => ({ ...prev, [clinica]: e.target.value }))
                    }
                    className="w-20 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)] disabled:cursor-not-allowed"
                    placeholder="—"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 opacity-50">
                  <label className="text-sm text-[var(--color-muted)]">
                    Objetivo de emitidos
                    <span className="text-[10px] text-[var(--color-muted)] block">Próximamente</span>
                  </label>
                  <input
                    type="number"
                    disabled
                    className="w-20 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm bg-[var(--color-surface-muted)] text-[var(--color-muted)] cursor-not-allowed"
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => saveObjetivo(clinica)}
                  disabled={isSaving || !editVal || cerrado}
                  className={`inline-flex items-center gap-1 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                    isSaved
                      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30"
                      : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
                  }`}
                >
                  {isSaving ? (
                    "Guardando…"
                  ) : isSaved ? (
                    <>
                      <Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Guardado
                    </>
                  ) : (
                    "Guardar"
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
