"use client";

// app/components/presupuestos/ConfigAutomatizaciones.tsx
// Centro de control: Automatizaciones · Objetivos · Notificaciones · Clínica

import { useState, useEffect } from "react";
import type { UserSession, ConfiguracionAutomatizacion } from "../../lib/presupuestos/types";

interface Props {
  user: UserSession;
}

type SidebarSection = "automatizaciones" | "objetivos" | "notificaciones" | "clinica";

const DEFAULTS: Omit<ConfiguracionAutomatizacion, "clinica"> = {
  activa: true,
  diasInactividadAlerta: 3,
  diasPortalSinRespuesta: 2,
  diasReactivacion: 90,
};

type ConfigMap = Record<string, ConfiguracionAutomatizacion>;

// ─── Section ①: Automatizaciones ─────────────────────────────────────────────

function SectionAutomatizaciones({ user }: { user: UserSession }) {
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [clinicas, setClinicas] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [configRes, clinicasRes] = await Promise.all([
          fetch("/api/automatizaciones/configuracion").then((r) => r.json()),
          fetch("/api/presupuestos/clinicas").then((r) => r.json()),
        ]);
        const map: ConfigMap = {};
        if (configRes.configuraciones) {
          for (const c of configRes.configuraciones as ConfiguracionAutomatizacion[]) {
            map[c.clinica] = c;
          }
        } else if (configRes.configuracion) {
          const c = configRes.configuracion as ConfiguracionAutomatizacion;
          map[c.clinica] = c;
        }
        setConfigs(map);
        setClinicas(clinicasRes.clinicas ?? []);
      } catch {
        setConfigs({});
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const allClinicas = Array.from(new Set([...Object.keys(configs), ...clinicas])).sort();

  function getConfig(clinica: string): ConfiguracionAutomatizacion {
    return configs[clinica] ?? { clinica, ...DEFAULTS };
  }

  function updateConfig(clinica: string, patch: Partial<Omit<ConfiguracionAutomatizacion, "clinica">>) {
    setConfigs((prev) => ({ ...prev, [clinica]: { ...getConfig(clinica), ...patch } }));
  }

  async function saveConfig(clinica: string) {
    setSaving((p) => ({ ...p, [clinica]: true }));
    try {
      await fetch("/api/automatizaciones/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getConfig(clinica)),
      });
      setSaved((p) => ({ ...p, [clinica]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [clinica]: false })), 2000);
    } catch { /* silent */ }
    finally { setSaving((p) => ({ ...p, [clinica]: false })); }
  }

  async function seedDemo() {
    setSeedLoading(true);
    try {
      await fetch("/api/automatizaciones/seed-demo", { method: "POST" });
      setSeedDone(true);
      setTimeout(() => setSeedDone(false), 3000);
    } catch { /* silent */ }
    finally { setSeedLoading(false); }
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
    <div className="space-y-8">
      {/* Mode selector */}
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">Modo de operación</h3>
        <p className="text-xs text-slate-500 mb-4">Elige cómo quieres que funcionen las automatizaciones</p>
        <div className="grid grid-cols-3 gap-3">
          {/* Mode A — active */}
          <div className="rounded-2xl border-2 border-violet-500 bg-violet-50 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-violet-900">Modo A</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-600 text-white">Activo</span>
            </div>
            <p className="text-xs text-violet-700 font-medium mb-1">Prepara, no envía</p>
            <p className="text-[11px] text-violet-600 leading-relaxed">
              Los mensajes se generan automáticamente y se colocan en cola para revisión antes de enviar.
            </p>
          </div>
          {/* Mode B — disabled */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-60 cursor-not-allowed">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-slate-600">Modo B</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">WhatsApp Business API</span>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-1">Envío semi-automático</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Requiere conexión con WhatsApp Business API para envío con confirmación.
            </p>
          </div>
          {/* Mode C — disabled */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-60 cursor-not-allowed">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-slate-600">Modo C</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">Próximamente</span>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-1">Totalmente autónomo</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Envío automático completo con aprendizaje continuo y optimización.
            </p>
          </div>
        </div>
      </div>

      {/* Config per clinic */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Configuración por clínica</h3>
            <p className="text-xs text-slate-500 mt-0.5">Umbrales de activación para cada evento automático</p>
          </div>
          <button
            onClick={seedDemo}
            disabled={seedLoading}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
              seedDone
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
            }`}
          >
            {seedLoading ? "Cargando…" : seedDone ? "✓ Demo cargada" : "Cargar demo"}
          </button>
        </div>

        {allClinicas.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">No hay clínicas configuradas todavía.</p>
          </div>
        )}

        <div className="space-y-4">
          {allClinicas.map((clinica) => {
            const cfg = getConfig(clinica);
            const isSaving = saving[clinica] ?? false;
            const isSaved = saved[clinica] ?? false;
            return (
              <div key={clinica} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="font-semibold text-slate-900">{clinica}</h4>
                  <button
                    onClick={() => updateConfig(clinica, { activa: !cfg.activa })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      cfg.activa ? "bg-violet-600" : "bg-slate-200"
                    }`}
                    title={cfg.activa ? "Desactivar" : "Activar"}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${cfg.activa ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                <div className={`space-y-3 ${!cfg.activa ? "opacity-40 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600 flex-1">
                      Días sin actividad para alertar
                      <span className="text-[10px] text-slate-400 block">Evento: presupuesto inactivo</span>
                    </label>
                    <input
                      type="number" min={1} max={30}
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
                      type="number" min={1} max={14}
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
                      type="number" min={30} max={365}
                      value={cfg.diasReactivacion}
                      onChange={(e) => updateConfig(clinica, { diasReactivacion: Number(e.target.value) })}
                      className="w-16 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-400"
                    />
                  </div>
                </div>

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
        </div>
      </div>
    </div>
  );
}

// ─── Section ②: Objetivos del mes ────────────────────────────────────────────

function SectionObjetivos({ user }: { user: UserSession }) {
  const [objetivos, setObjetivos] = useState<Record<string, number>>({});
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [aceptadosMTD, setAceptadosMTD] = useState<Record<string, number>>({});
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const mesMTD = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [objData, kanbanData, clinicasData] = await Promise.all([
          fetch(`/api/presupuestos/objetivos?mes=${mesMTD}`).then((r) => r.json()),
          fetch(`/api/presupuestos/kanban`).then((r) => r.json()),
          fetch("/api/presupuestos/clinicas").then((r) => r.json()),
        ]);
        const objMap: Record<string, number> = {};
        for (const o of (objData.objetivos ?? [])) {
          objMap[o.clinica] = o.objetivo_aceptados;
        }
        setObjetivos(objMap);

        const aceptMap: Record<string, number> = {};
        for (const p of (kanbanData.presupuestos ?? [])) {
          if (p.estado === "ACEPTADO" && p.fechaPresupuesto?.startsWith(mesMTD)) {
            const key = p.clinica ?? "Sin clínica";
            aceptMap[key] = (aceptMap[key] ?? 0) + 1;
          }
        }
        setAceptadosMTD(aceptMap);
        setClinicas(clinicasData.clinicas ?? []);
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allClinicas = Array.from(new Set([...Object.keys(objetivos), ...clinicas])).sort();

  async function saveObjetivo(clinica: string) {
    const rawVal = editVals[clinica];
    const val = rawVal !== undefined ? Number(rawVal) : objetivos[clinica];
    if (!val) return;
    setSaving((p) => ({ ...p, [clinica]: true }));
    try {
      await fetch("/api/presupuestos/objetivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinica, mes: mesMTD, objetivo_aceptados: val }),
      });
      setObjetivos((prev) => ({ ...prev, [clinica]: val }));
      setSaved((p) => ({ ...p, [clinica]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [clinica]: false })), 2000);
    } catch { /* silent */ }
    finally { setSaving((p) => ({ ...p, [clinica]: false })); }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">Objetivo mensual</h3>
        <p className="text-xs text-slate-500 mb-4">Define cuántos presupuestos deberían aceptarse este mes por clínica</p>
      </div>

      {allClinicas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-sm">No hay clínicas disponibles todavía.</p>
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
            <div key={clinica} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3 mb-4">
                <h4 className="font-semibold text-slate-900 flex-1">{clinica}</h4>
                {obj != null && (
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    actual >= obj
                      ? "bg-emerald-100 text-emerald-700"
                      : pct >= 70 ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {actual}/{obj}
                  </span>
                )}
              </div>

              {obj != null && (
                <div className="mb-4">
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        actual >= obj ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-rose-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{pct}% del objetivo este mes</p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-slate-600">Objetivo de aceptados</label>
                  <input
                    type="number"
                    min={1}
                    value={editVal}
                    onChange={(e) => setEditVals((prev) => ({ ...prev, [clinica]: e.target.value }))}
                    className="w-20 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-400"
                    placeholder="—"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 opacity-50">
                  <label className="text-sm text-slate-400">
                    Objetivo de emitidos
                    <span className="text-[10px] text-slate-400 block">Próximamente</span>
                  </label>
                  <input
                    type="number"
                    disabled
                    className="w-20 text-center border border-slate-200 rounded-lg px-2 py-1 text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => saveObjetivo(clinica)}
                  disabled={isSaving || !editVal}
                  className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                    isSaved
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-violet-600 text-white hover:bg-violet-700"
                  }`}
                >
                  {isSaving ? "Guardando…" : isSaved ? "✓ Guardado" : "Guardar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section ③: Notificaciones ────────────────────────────────────────────────

const NOTIF_KEY = "fyllio_notif_prefs";

interface NotifPrefs {
  aceptado: boolean;
  portalVisto: boolean;
  mensajePreparado: boolean;
  resumenDiario: boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  aceptado: true,
  portalVisto: true,
  mensajePreparado: true,
  resumenDiario: false,
};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function SectionNotificaciones() {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [permGranted, setPermGranted] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_KEY);
      if (raw) setPrefs(JSON.parse(raw));
    } catch { /* ignore */ }
    if ("Notification" in window) {
      setPermGranted(Notification.permission === "granted");
    }
  }, []);

  function toggle(key: keyof NotifPrefs) {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(NOTIF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  async function activarNotificaciones() {
    setActivateError(null);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setActivateError("Tu navegador no soporta notificaciones push.");
      return;
    }
    setActivating(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setActivateError("Permiso denegado. Actívalo en la configuración de tu navegador.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setActivateError("Clave VAPID no configurada.");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await fetch("/api/push/suscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });

      setPermGranted(true);
    } catch (err) {
      setActivateError(`Error al activar: ${err instanceof Error ? err.message : "desconocido"}`);
    } finally {
      setActivating(false);
    }
  }

  async function desactivarNotificaciones() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/suscribir", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPermGranted(false);
    } catch { /* silent */ }
  }

  const rows: { key: keyof NotifPrefs; label: string; desc: string }[] = [
    { key: "aceptado",         label: "Presupuesto aceptado",      desc: "Notifica cuando un paciente acepta un presupuesto" },
    { key: "portalVisto",      label: "Portal visto por paciente", desc: "Notifica cuando el paciente abre el enlace del portal" },
    { key: "mensajePreparado", label: "Nuevo mensaje preparado",   desc: "Notifica cuando hay mensajes nuevos en la cola de automatizaciones" },
    { key: "resumenDiario",    label: "Resumen diario",            desc: "Resumen cada mañana con las tareas prioritarias del día" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">Notificaciones push</h3>
        <p className="text-xs text-slate-500 mb-4">Elige qué eventos quieres recibir como notificación</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {rows.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center gap-4 p-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">{label}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
            </div>
            <button
              onClick={() => toggle(key)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                prefs[key] ? "bg-violet-600" : "bg-slate-200"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${prefs[key] ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-lg shrink-0">🔔</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700">Activar notificaciones del navegador</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">
              Para recibir notificaciones push necesitas dar permiso al navegador. Las preferencias de arriba se aplicarán una vez activas.
            </p>
            {activateError && (
              <p className="text-xs text-rose-600 mb-3">{activateError}</p>
            )}
            {permGranted ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                  ✓ Notificaciones activas
                </span>
                <button
                  onClick={desactivarNotificaciones}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600 underline"
                >
                  Desactivar
                </button>
              </div>
            ) : (
              <button
                onClick={activarNotificaciones}
                disabled={activating}
                className="text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
              >
                {activating ? "Activando…" : "Activar notificaciones"}
              </button>
            )}
          </div>
        </div>
      </div>

      {process.env.NODE_ENV === "development" && (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-700 mb-2">Dev: probar push</p>
          <button
            onClick={() => fetch("/api/push/enviar", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-secret": process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
              },
              body: JSON.stringify({ title: "🧪 Prueba", body: "Notificación de prueba de Fyllio", url: "/presupuestos", tag: "test" }),
            })}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
          >
            Enviar notificación de prueba
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Section ④: Clínica y equipo ─────────────────────────────────────────────

function SectionClinica({ user }: { user: UserSession }) {
  const [clinicas, setClinicas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/presupuestos/clinicas")
      .then((r) => r.json())
      .then((d) => { setClinicas(d.clinicas ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const rolLabel: Record<string, string> = {
    manager_general:  "Manager General",
    encargada_ventas: "Encargada de Ventas",
    admin:            "Administrador",
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">Clínica y equipo</h3>
        <p className="text-xs text-slate-500 mb-4">Información sobre la red de clínicas y tu cuenta</p>
      </div>

      {/* Current user */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center text-xl shrink-0">
            👤
          </div>
          <div>
            <p className="font-semibold text-slate-900">{user.nombre}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
            <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              {rolLabel[user.rol] ?? user.rol}
            </span>
          </div>
        </div>
        {user.clinica && (
          <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Clínica asignada</span>
            <span className="text-xs font-semibold text-slate-700">{user.clinica}</span>
          </div>
        )}
      </div>

      {/* Clinic list */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1].map((i) => <div key={i} className="h-14 rounded-2xl bg-slate-100" />)}
        </div>
      ) : clinicas.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Red de clínicas ({clinicas.length})
          </h4>
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {clinicas.map((c) => (
              <div key={c} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base">🏥</span>
                <span className="text-sm text-slate-700">{c}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const SIDEBAR_ITEMS: { id: SidebarSection; label: string; icon: string }[] = [
  { id: "automatizaciones", label: "Automatizaciones", icon: "🤖" },
  { id: "objetivos",        label: "Objetivos del mes", icon: "🎯" },
  { id: "notificaciones",   label: "Notificaciones",    icon: "🔔" },
  { id: "clinica",          label: "Clínica y equipo",  icon: "🏥" },
];

export default function ConfigAutomatizaciones({ user }: Props) {
  const [activeSection, setActiveSection] = useState<SidebarSection>("automatizaciones");

  return (
    <div className="flex gap-6 min-h-0">
      {/* Sidebar */}
      <aside className="w-52 shrink-0">
        <nav className="space-y-1">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeSection === item.id
                  ? "bg-violet-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-auto pb-6">
        {activeSection === "automatizaciones" && <SectionAutomatizaciones user={user} />}
        {activeSection === "objetivos"        && <SectionObjetivos user={user} />}
        {activeSection === "notificaciones"   && <SectionNotificaciones />}
        {activeSection === "clinica"          && <SectionClinica user={user} />}
      </div>
    </div>
  );
}
