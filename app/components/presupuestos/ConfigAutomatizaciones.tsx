"use client";

// app/components/presupuestos/ConfigAutomatizaciones.tsx
// Centro de control: Automatizaciones · Objetivos · Notificaciones · Clínica

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bot,
  Target,
  MessageCircle,
  FileText,
  CalendarClock,
  Bell,
  Building2,
  User,
  Check,
  Plus,
  X,
  ICON_STROKE,
} from "../icons";
import { ErrorState } from "../ui/Feedback";
import type { UserSession, ConfiguracionAutomatizacion, ModoWhatsApp, PlantillaMensaje, TipoPlantilla, ConfigRecordatorios } from "../../lib/presupuestos/types";

interface Props {
  user: UserSession;
}

type SidebarSection = "automatizaciones" | "objetivos" | "notificaciones" | "clinica" | "whatsapp" | "plantillas" | "recordatorios";

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
  const [loadError, setLoadError] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [clinicas, setClinicas] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    } catch {
      toast.error("No se pudo guardar la configuración. Inténtalo de nuevo.");
    }
    finally { setSaving((p) => ({ ...p, [clinica]: false })); }
  }

  async function seedDemo() {
    setSeedLoading(true);
    try {
      await fetch("/api/automatizaciones/seed-demo", { method: "POST" });
      setSeedDone(true);
      setTimeout(() => setSeedDone(false), 3000);
    } catch {
      toast.error("No se pudo cargar la demo. Inténtalo de nuevo.");
    }
    finally { setSeedLoading(false); }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]">
            <div className="h-4 w-40 bg-[var(--color-border)] rounded mb-4" />
            <div className="space-y-3">
              <div className="h-3 w-64 bg-[var(--color-surface-muted)] rounded" />
              <div className="h-3 w-56 bg-[var(--color-surface-muted)] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        detail="La configuración de automatizaciones no está disponible ahora mismo."
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Mode selector */}
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Modo de operación</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">Elige cómo quieres que funcionen las automatizaciones</p>
        <div className="grid grid-cols-3 gap-3">
          {/* Mode A — active */}
          <div className="rounded-2xl border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-[var(--color-foreground)]">Modo A</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)]">Activo</span>
            </div>
            <p className="text-xs text-[var(--color-accent)] font-medium mb-1">Prepara, no envía</p>
            <p className="text-[11px] text-[var(--color-accent)] leading-relaxed">
              Los mensajes se generan automáticamente y se colocan en cola para revisión antes de enviar.
            </p>
          </div>
          {/* Mode B — disabled */}
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 opacity-60 cursor-not-allowed">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-[var(--color-muted)]">Modo B</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-border)] text-[var(--color-muted)]">WhatsApp Business API</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] font-medium mb-1">Envío semi-automático</p>
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
              Requiere conexión con WhatsApp Business API para envío con confirmación.
            </p>
          </div>
          {/* Mode C — disabled */}
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 opacity-60 cursor-not-allowed">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-sm font-bold text-[var(--color-muted)]">Modo C</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-border)] text-[var(--color-muted)]">Próximamente</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] font-medium mb-1">Totalmente autónomo</p>
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
              Envío automático completo con aprendizaje continuo y optimización.
            </p>
          </div>
        </div>
      </div>

      {/* Config per clinic */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Configuración por clínica</h3>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">Umbrales de activación para cada evento automático</p>
          </div>
          <button
            onClick={seedDemo}
            disabled={seedLoading}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
              seedDone
                ? "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            }`}
          >
            {seedLoading ? "Cargando…" : seedDone ? <><Check size={13} strokeWidth={ICON_STROKE} aria-hidden /> Demo cargada</> : "Cargar demo"}
          </button>
        </div>

        {allClinicas.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
            <p className="text-[var(--color-muted)] text-sm">No hay clínicas configuradas todavía.</p>
          </div>
        )}

        <div className="space-y-4">
          {allClinicas.map((clinica) => {
            const cfg = getConfig(clinica);
            const isSaving = saving[clinica] ?? false;
            const isSaved = saved[clinica] ?? false;
            return (
              <div key={clinica} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="font-semibold text-[var(--color-foreground)]">{clinica}</h4>
                  <button
                    onClick={() => updateConfig(clinica, { activa: !cfg.activa })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      cfg.activa ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
                    }`}
                    title={cfg.activa ? "Desactivar" : "Activar"}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-surface)] shadow transition-transform ${cfg.activa ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                <div className={`space-y-3 ${!cfg.activa ? "opacity-40 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-[var(--color-muted)] flex-1">
                      Días sin actividad para alertar
                      <span className="text-[10px] text-[var(--color-muted)] block">Evento: presupuesto inactivo</span>
                    </label>
                    <input
                      type="number" min={1} max={30}
                      value={cfg.diasInactividadAlerta}
                      onChange={(e) => updateConfig(clinica, { diasInactividadAlerta: Number(e.target.value) })}
                      className="w-16 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-[var(--color-muted)] flex-1">
                      Días portal sin respuesta
                      <span className="text-[10px] text-[var(--color-muted)] block">Evento: portal visto sin respuesta</span>
                    </label>
                    <input
                      type="number" min={1} max={14}
                      value={cfg.diasPortalSinRespuesta}
                      onChange={(e) => updateConfig(clinica, { diasPortalSinRespuesta: Number(e.target.value) })}
                      className="w-16 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-[var(--color-muted)] flex-1">
                      Días para reactivación de perdidos
                      <span className="text-[10px] text-[var(--color-muted)] block">Evento: reactivación programada</span>
                    </label>
                    <input
                      type="number" min={30} max={365}
                      value={cfg.diasReactivacion}
                      onChange={(e) => updateConfig(clinica, { diasReactivacion: Number(e.target.value) })}
                      className="w-16 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => saveConfig(clinica)}
                    disabled={isSaving}
                    className={`inline-flex items-center gap-1 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                      isSaved
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30"
                        : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
                    }`}
                  >
                    {isSaving ? "Guardando…" : isSaved ? <><Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Guardado</> : "Guardar cambios"}
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
  const [loadError, setLoadError] = useState(false);

  const mesMTD = new Date().toISOString().slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

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
    } catch {
      toast.error("No se pudo guardar el objetivo. Inténtalo de nuevo.");
    }
    finally { setSaving((p) => ({ ...p, [clinica]: false })); }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1].map((i) => <div key={i} className="h-24 rounded-2xl bg-[var(--color-surface-muted)]" />)}
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        detail="Los objetivos del mes no están disponibles ahora mismo."
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Objetivo mensual</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">Define cuántos presupuestos deberían aceptarse este mes por clínica</p>
      </div>

      {allClinicas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
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
            <div key={clinica} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <div className="flex items-center gap-3 mb-4">
                <h4 className="font-semibold text-[var(--color-foreground)] flex-1">{clinica}</h4>
                {obj != null && (
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    actual >= obj
                      ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : pct >= 70 ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                  }`}>
                    {actual}/{obj}
                  </span>
                )}
              </div>

              {obj != null && (
                <div className="mb-4">
                  <div className="h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        actual >= obj ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-rose-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)] mt-1">{pct}% del objetivo este mes</p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-[var(--color-muted)]">Objetivo de aceptados</label>
                  <input
                    type="number"
                    min={1}
                    value={editVal}
                    onChange={(e) => setEditVals((prev) => ({ ...prev, [clinica]: e.target.value }))}
                    className="w-20 text-center border border-[var(--color-border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-accent)]"
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
                  disabled={isSaving || !editVal}
                  className={`inline-flex items-center gap-1 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                    isSaved
                      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30"
                      : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
                  }`}
                >
                  {isSaving ? "Guardando…" : isSaved ? <><Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Guardado</> : "Guardar"}
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
        setActivateError("Las notificaciones push aún no están disponibles. Contacta con Fyllio para activarlas.");
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
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Notificaciones push</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">Elige qué eventos quieres recibir como notificación</p>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
        {rows.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center gap-4 p-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-foreground)]">{label}</p>
              <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{desc}</p>
            </div>
            <button
              onClick={() => toggle(key)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                prefs[key] ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-surface)] shadow transition-transform ${prefs[key] ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
        <div className="flex items-start gap-3">
          <Bell size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)] mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-foreground)]">Activar notificaciones del navegador</p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5 mb-3">
              Para recibir notificaciones push necesitas dar permiso al navegador. Las preferencias de arriba se aplicarán una vez activas.
            </p>
            {activateError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">{activateError}</p>
            )}
            {permGranted ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  <Check size={13} strokeWidth={ICON_STROKE} aria-hidden /> Notificaciones activas
                </span>
                <button
                  onClick={desactivarNotificaciones}
                  className="text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] underline"
                >
                  Desactivar
                </button>
              </div>
            ) : (
              <button
                onClick={activarNotificaciones}
                disabled={activating}
                className="text-xs font-semibold px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors disabled:opacity-50"
              >
                {activating ? "Activando…" : "Activar notificaciones"}
              </button>
            )}
          </div>
        </div>
      </div>
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
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Clínica y equipo</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">Información sobre la red de clínicas y tu cuenta</p>
      </div>

      {/* Current user */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-soft)] flex items-center justify-center shrink-0">
            <User size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          </div>
          <div>
            <p className="font-semibold text-[var(--color-foreground)]">{user.nombre}</p>
            <p className="text-xs text-[var(--color-muted)]">{user.email}</p>
            <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              {rolLabel[user.rol] ?? user.rol}
            </span>
          </div>
        </div>
        {user.clinica && (
          <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-border)]">
            <span className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">Clínica asignada</span>
            <span className="text-xs font-semibold text-[var(--color-foreground)]">{user.clinica}</span>
          </div>
        )}
      </div>

      {/* Clinic list */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1].map((i) => <div key={i} className="h-14 rounded-2xl bg-[var(--color-surface-muted)]" />)}
        </div>
      ) : clinicas.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-3">
            Red de clínicas ({clinicas.length})
          </h4>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
            {clinicas.map((c) => (
              <div key={c} className="flex items-center gap-3 px-4 py-3">
                <Building2 size={16} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                <span className="text-sm text-[var(--color-foreground)]">{c}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Section ⑤: Integración WhatsApp ──────────────────────────────────────────

type WABAEstado = {
  credencialesConfiguradas: boolean;
  activoParaClinica: boolean;
  numeroConectado?: string;
  ultimoMensajeEnviado?: string;
  ultimoMensajeRecibido?: string;
  tokenExpirado?: boolean;
};

function formatearHace(iso?: string): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "nunca";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function SectionWhatsApp({ user }: { user: UserSession }) {
  const [modo, setModo] = useState<ModoWhatsApp>("manual");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wabaEstado, setWabaEstado] = useState<WABAEstado | null>(null);
  const [togglingActivo, setTogglingActivo] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Clínica efectiva para el scope de esta vista (igual patrón que handleSave).
  const clinicaScope = user.clinica ?? "default";

  async function fetchWabaEstado(): Promise<WABAEstado | null> {
    const res = await fetch(
      `/api/presupuestos/configuracion-waba?clinica=${encodeURIComponent(clinicaScope)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as WABAEstado;
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [resCfg, dataWaba] = await Promise.all([
          fetch("/api/automatizaciones/configuracion"),
          fetchWabaEstado(),
        ]);
        const dataCfg = await resCfg.json();
        const configs = dataCfg.configuraciones ?? (dataCfg.configuracion ? [dataCfg.configuracion] : []);
        const cfg = configs.find((c: ConfiguracionAutomatizacion) => c.modoWhatsapp);
        if (cfg?.modoWhatsapp) setModo(cfg.modoWhatsapp);

        if (dataWaba) setWabaEstado(dataWaba);
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicaScope]);

  async function handleSave(nuevoModo: ModoWhatsApp) {
    setModo(nuevoModo);
    setSaving(true);
    try {
      const clinica = user.clinica ?? "default";
      await fetch("/api/automatizaciones/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinica, modoWhatsapp: nuevoModo }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("No se pudo guardar el modo de WhatsApp. Inténtalo de nuevo.");
    }
    finally { setSaving(false); }
  }

  async function handleToggleActivo() {
    if (!wabaEstado) return;
    const nuevoActivo = !wabaEstado.activoParaClinica;
    setToggleError(null);
    setTogglingActivo(true);
    // Optimistic: reflejar el cambio inmediatamente.
    setWabaEstado({ ...wabaEstado, activoParaClinica: nuevoActivo });
    try {
      const res = await fetch("/api/presupuestos/configuracion-waba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinica: clinicaScope, activoParaClinica: nuevoActivo }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      // Refetch para garantizar persistencia real en Airtable.
      const fresh = await fetchWabaEstado();
      if (fresh) setWabaEstado(fresh);
    } catch (err) {
      // Revertir optimistic + mostrar error.
      setWabaEstado({ ...wabaEstado, activoParaClinica: !nuevoActivo });
      setToggleError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setTogglingActivo(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-2xl bg-[var(--color-surface-muted)]" />
        <div className="h-32 rounded-2xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  const wabaHabilitable = wabaEstado?.credencialesConfiguradas === true;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Integración WhatsApp</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">Elige cómo se envían y reciben los mensajes de WhatsApp</p>
      </div>

      {/* Banner: token expirado */}
      {wabaEstado?.tokenExpirado && (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 p-4">
          <p className="text-sm font-bold text-rose-800 dark:text-rose-300 mb-1">Conexión con WhatsApp caducada</p>
          <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
            La conexión con WhatsApp ha caducado. Contacta con Fyllio para renovarla.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {/* Manual mode */}
        <button
          onClick={() => handleSave("manual")}
          disabled={saving}
          className={`w-full text-left rounded-2xl border-2 p-5 transition-colors ${
            modo === "manual"
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-muted)]"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-4 h-4 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              modo === "manual" ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
            }`}>
              {modo === "manual" && <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />}
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--color-foreground)]">Manual (gratis)</p>
              <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
                La clínica envía los mensajes manualmente con un clic.
                Se abre WhatsApp Web con el mensaje prellenado. Sin coste, sin configuración.
              </p>
              {modo === "manual" && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Activo
                </span>
              )}
            </div>
          </div>
        </button>

        {/* WABA mode */}
        <button
          onClick={() => wabaHabilitable && handleSave("waba")}
          disabled={saving || !wabaHabilitable}
          className={`w-full text-left rounded-2xl border-2 p-5 transition-colors ${
            modo === "waba"
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
              : wabaHabilitable
                ? "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-muted)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] opacity-60 cursor-not-allowed"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-4 h-4 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              modo === "waba" ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
            }`}>
              {modo === "waba" && <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />}
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--color-foreground)]">Automático con WABA</p>
              <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
                Integración completa con WhatsApp Business API.
                Los mensajes se envían y reciben automáticamente.
              </p>
              {!wabaHabilitable && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-semibold text-[var(--color-muted)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">
                  Credenciales no configuradas
                </span>
              )}
              {modo === "waba" && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Activo
                </span>
              )}
            </div>
          </div>
        </button>
      </div>

      {saved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold text-center">Modo guardado correctamente</p>
      )}

      {/* Panel de estado WABA */}
      {wabaEstado && !wabaEstado.credencialesConfiguradas && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
          <p className="text-sm font-semibold text-[var(--color-foreground)] mb-2">Envío automático no configurado</p>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            Esta clínica aún no tiene el envío automático de WhatsApp activado. Contacta con Fyllio para configurarlo.
          </p>
        </div>
      )}

      {wabaEstado?.credencialesConfiguradas && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[var(--color-foreground)]">Credenciales configuradas</p>
              {wabaEstado.numeroConectado && (
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Número conectado: <span className="font-mono">{wabaEstado.numeroConectado}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-muted)]">
                {wabaEstado.activoParaClinica ? "Activo" : "Desactivado"}
              </span>
              <button
                onClick={handleToggleActivo}
                disabled={togglingActivo}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  wabaEstado.activoParaClinica ? "bg-emerald-500" : "bg-[var(--color-border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-[var(--color-surface)] rounded-full transition-transform ${
                    wabaEstado.activoParaClinica ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {toggleError && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 -mt-2">No se pudo guardar: {toggleError}</p>
          )}

          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[var(--color-border)]">
            <div>
              <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">Último enviado</p>
              <p className="text-xs text-[var(--color-foreground)] mt-0.5">{formatearHace(wabaEstado.ultimoMensajeEnviado)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">Último recibido</p>
              <p className="text-xs text-[var(--color-foreground)] mt-0.5">{formatearHace(wabaEstado.ultimoMensajeRecibido)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section ⑥: Plantillas de Mensaje ─────────────────────────────────────────

const TIPO_PLANTILLA_ORDER: TipoPlantilla[] = ["Primer contacto", "Recordatorio", "Detalles de pago", "Reactivacion"];
const TIPO_PLANTILLA_LABEL: Record<TipoPlantilla, string> = {
  "Primer contacto": "PRIMER CONTACTO",
  "Recordatorio": "RECORDATORIO",
  "Detalles de pago": "DETALLES DE PAGO",
  "Reactivacion": "REACTIVACIÓN",
};

const PREVIEW_DATA = {
  nombre: "María",
  tratamiento: "Implantes dentales",
  importe: "3.500€",
  doctor: "Dr. Rojas",
  clinica: "Clínica Central",
};

function sustituirVariablesPreview(contenido: string): string {
  return contenido
    .replace(/\{nombre\}/g, PREVIEW_DATA.nombre)
    .replace(/\{tratamiento\}/g, PREVIEW_DATA.tratamiento)
    .replace(/\{importe\}/g, PREVIEW_DATA.importe)
    .replace(/\{doctor\}/g, PREVIEW_DATA.doctor)
    .replace(/\{clinica\}/g, PREVIEW_DATA.clinica);
}

function SectionPlantillas({ user }: { user: UserSession }) {
  const [plantillas, setPlantillas] = useState<PlantillaMensaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlantilla, setEditingPlantilla] = useState<PlantillaMensaje | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);

  // Form state
  const [formNombre, setFormNombre] = useState("");
  const [formTipo, setFormTipo] = useState<TipoPlantilla>("Primer contacto");
  const [formDoctor, setFormDoctor] = useState("");
  const [formTratamiento, setFormTratamiento] = useState("");
  const [formContenido, setFormContenido] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  useEffect(() => {
    fetchPlantillas();
  }, []);

  async function fetchPlantillas() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/presupuestos/plantillas");
      const data = await res.json();
      setPlantillas(data.plantillas ?? []);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }

  function openNew() {
    setEditingPlantilla(null);
    setFormNombre("");
    setFormTipo("Primer contacto");
    setFormDoctor("");
    setFormTratamiento("");
    setFormContenido("");
    setModalOpen(true);
  }

  function openEdit(p: PlantillaMensaje) {
    setEditingPlantilla(p);
    setFormNombre(p.nombre);
    setFormTipo(p.tipo);
    setFormDoctor(p.doctor);
    setFormTratamiento(p.tratamiento);
    setFormContenido(p.contenido);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!formNombre || !formContenido) return;
    setFormSaving(true);
    try {
      const body: any = {
        nombre: formNombre,
        tipo: formTipo,
        clinica: user.clinica || "Todas",
        doctor: formDoctor,
        tratamiento: formTratamiento,
        contenido: formContenido,
      };
      if (editingPlantilla) {
        body.id = editingPlantilla.id;
        await fetch("/api/presupuestos/plantillas", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetch("/api/presupuestos/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setModalOpen(false);
      fetchPlantillas();
      toast.success(editingPlantilla ? "Plantilla actualizada" : "Plantilla creada");
    } catch {
      toast.error("No se pudo guardar la plantilla. Inténtalo de nuevo.");
    }
    finally { setFormSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/presupuestos/plantillas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setPlantillas((prev) => prev.filter((p) => p.id !== id));
      if (editingPlantilla?.id === id) setModalOpen(false);
      toast.success("Plantilla eliminada");
    } catch {
      toast.error("No se pudo eliminar la plantilla. Inténtalo de nuevo.");
    }
  }

  async function handleGenerarIA() {
    setGenerandoIA(true);
    try {
      const res = await fetch("/api/presupuestos/plantillas/generar-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: formTipo,
          doctor: formDoctor || undefined,
          tratamiento: formTratamiento || undefined,
          clinica: user.clinica || undefined,
        }),
      });
      const data = await res.json();
      if (data.contenido) setFormContenido(data.contenido);
    } catch {
      toast.error("No se pudo generar el contenido. Inténtalo de nuevo.");
    }
    finally { setGenerandoIA(false); }
  }

  // Group by type
  const grouped = TIPO_PLANTILLA_ORDER.map((tipo) => ({
    tipo,
    items: plantillas.filter((p) => p.tipo === tipo),
  }));

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-[var(--color-surface-muted)]" />)}
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        detail="Las plantillas de mensaje no están disponibles ahora mismo."
        onRetry={fetchPlantillas}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Plantillas de mensaje</h3>
          <p className="text-xs text-[var(--color-muted)]">Plantillas reutilizables con variables personalizables</p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
          Nueva plantilla
        </button>
      </div>

      {/* Grouped list */}
      {grouped.map(({ tipo, items }) => (
        <div key={tipo}>
          <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">
            {TIPO_PLANTILLA_LABEL[tipo]} ({items.length})
          </p>
          {items.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic mb-4">Sin plantillas</p>
          ) : (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)] mb-4">
              {items.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openEdit(p)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-muted)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{p.nombre}</p>
                    <p className="text-[10px] text-[var(--color-muted)] mt-0.5">
                      {p.doctor ? p.doctor : "Todos los doctores"}
                      {p.tratamiento ? ` · ${p.tratamiento}` : ""}
                    </p>
                  </div>
                  {!p.activa && (
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                      Inactiva
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
                {editingPlantilla ? "Editar plantilla" : "Nueva plantilla"}
              </h3>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Nombre */}
              <div>
                <label className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Nombre</label>
                <input
                  type="text"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej: Primer contacto implantes"
                  className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Tipo</label>
                <select
                  value={formTipo}
                  onChange={(e) => setFormTipo(e.target.value as TipoPlantilla)}
                  className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                >
                  {TIPO_PLANTILLA_ORDER.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Doctor + Tratamiento */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Doctor (opcional)</label>
                  <input
                    type="text"
                    value={formDoctor}
                    onChange={(e) => setFormDoctor(e.target.value)}
                    placeholder="Todos"
                    className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Tratamiento (opcional)</label>
                  <input
                    type="text"
                    value={formTratamiento}
                    onChange={(e) => setFormTratamiento(e.target.value)}
                    placeholder="Todos"
                    className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              {/* Variables hint */}
              <div className="rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-3">
                <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-1">Variables disponibles</p>
                <p className="text-xs text-[var(--color-muted)] font-mono">
                  {"{nombre}"} {"{tratamiento}"} {"{importe}"} {"{doctor}"} {"{clinica}"}
                </p>
              </div>

              {/* Contenido */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide">Contenido</label>
                  <button
                    onClick={handleGenerarIA}
                    disabled={generandoIA}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors disabled:opacity-50"
                  >
                    {generandoIA ? "Generando..." : "Generar con IA"}
                  </button>
                </div>
                <textarea
                  value={formContenido}
                  onChange={(e) => setFormContenido(e.target.value)}
                  rows={5}
                  placeholder="Hola {nombre}, te escribimos desde {clinica}..."
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </div>

              {/* Preview */}
              {formContenido && (
                <div>
                  <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-1">Vista previa</p>
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3">
                    <p className="text-sm text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap leading-relaxed">
                      {sustituirVariablesPreview(formContenido)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[var(--color-border)] flex items-center gap-2">
              {editingPlantilla && (
                <button
                  onClick={() => handleDelete(editingPlantilla.id)}
                  className="text-xs font-semibold px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                >
                  Eliminar
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setModalOpen(false)}
                className="text-xs font-semibold px-3 py-2 rounded-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={formSaving || !formNombre || !formContenido}
                className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
              >
                {formSaving ? "Guardando..." : editingPlantilla ? "Actualizar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section ⑦: Recordatorios Automáticos ─────────────────────────────────────

const RECORDATORIOS_DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};

function SectionRecordatorios({ user }: { user: UserSession }) {
  const [config, setConfig] = useState<ConfigRecordatorios>({
    clinica: user.clinica || "default",
    ...RECORDATORIOS_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nuevosDias, setNuevosDias] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const clinica = user.clinica || "";
        const res = await fetch(`/api/presupuestos/recordatorios/configuracion${clinica ? `?clinica=${encodeURIComponent(clinica)}` : ""}`);
        const data = await res.json();
        if (data.configuracion) {
          setConfig(data.configuracion);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
  }, [user.clinica]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/presupuestos/recordatorios/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("No se pudo guardar la configuración. Inténtalo de nuevo.");
    }
    finally { setSaving(false); }
  }

  function removeDia(index: number) {
    setConfig((prev) => ({
      ...prev,
      secuenciaDias: prev.secuenciaDias.filter((_, i) => i !== index),
    }));
  }

  function addDia() {
    const val = Number(nuevosDias);
    if (!val || val <= 0 || config.secuenciaDias.includes(val)) return;
    setConfig((prev) => ({
      ...prev,
      secuenciaDias: [...prev.secuenciaDias, val].sort((a, b) => a - b),
    }));
    setNuevosDias("");
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-2xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Recordatorios automáticos</h3>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Configura cuándo se envían recordatorios de seguimiento a pacientes que no responden
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-5">
        {/* Secuencia de días */}
        <div>
          <label className="text-sm font-medium text-[var(--color-foreground)] block mb-2">Secuencia de recordatorios</label>
          <p className="text-xs text-[var(--color-muted)] mb-3">Enviar recordatorio a los:</p>
          <div className="flex flex-wrap items-center gap-2">
            {config.secuenciaDias.map((dia, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-sm font-semibold px-3 py-1.5 rounded-lg">
                {dia} días
                <button
                  onClick={() => removeDia(i)}
                  className="text-[var(--color-accent)] hover:opacity-70 ml-1"
                  aria-label={`Quitar recordatorio de ${dia} días`}
                >
                  <X size={12} strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={90}
                value={nuevosDias}
                onChange={(e) => setNuevosDias(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDia()}
                placeholder="—"
                className="w-14 text-center border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={addDia}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
              >
                <Plus size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Añadir
              </button>
            </div>
          </div>
        </div>

        {/* Hora de envío */}
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm text-[var(--color-muted)]">
            Hora de envío
            <span className="text-[10px] text-[var(--color-muted)] block">Hora a la que se programan los envíos</span>
          </label>
          <input
            type="time"
            value={config.horaEnvio}
            onChange={(e) => setConfig((prev) => ({ ...prev, horaEnvio: e.target.value }))}
            className="w-24 text-center border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        {/* Días rechazo auto */}
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm text-[var(--color-muted)]">
            Marcar como rechazado si no responde después de
            <span className="text-[10px] text-[var(--color-muted)] block">Días desde el último recordatorio</span>
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={7}
              max={365}
              value={config.diasRechazoAuto}
              onChange={(e) => setConfig((prev) => ({ ...prev, diasRechazoAuto: Number(e.target.value) }))}
              className="w-16 text-center border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-xs text-[var(--color-muted)]">días</span>
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`inline-flex items-center gap-1 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
              saved
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30"
                : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
            }`}
          >
            {saving ? "Guardando…" : saved ? <><Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Guardado</> : "Guardar configuración"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const SIDEBAR_ITEMS: { id: SidebarSection; label: string; icon: ReactNode }[] = [
  { id: "automatizaciones", label: "Automatizaciones", icon: <Bot size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "objetivos",        label: "Objetivos del mes", icon: <Target size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "whatsapp",         label: "WhatsApp",          icon: <MessageCircle size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "plantillas",       label: "Plantillas",        icon: <FileText size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "recordatorios",    label: "Recordatorios",     icon: <CalendarClock size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "notificaciones",   label: "Notificaciones",    icon: <Bell size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
  { id: "clinica",          label: "Clínica y equipo",  icon: <Building2 size={16} strokeWidth={ICON_STROKE} aria-hidden /> },
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
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {item.icon && <span className="shrink-0 leading-none" aria-hidden>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-auto pb-6">
        {activeSection === "automatizaciones" && <SectionAutomatizaciones user={user} />}
        {activeSection === "objetivos"        && <SectionObjetivos user={user} />}
        {activeSection === "whatsapp"         && <SectionWhatsApp user={user} />}
        {activeSection === "plantillas"       && <SectionPlantillas user={user} />}
        {activeSection === "recordatorios"    && <SectionRecordatorios user={user} />}
        {activeSection === "notificaciones"   && <SectionNotificaciones />}
        {activeSection === "clinica"          && <SectionClinica user={user} />}
      </div>
    </div>
  );
}
