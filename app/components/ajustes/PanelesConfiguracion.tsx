"use client";

// app/components/ajustes/PanelesConfiguracion.tsx
//
// Los paneles de configuración que vivían en la pestaña «Reglas y objetivos» de
// /automatizaciones. Cada uno es ahora una sección de /ajustes con su propia
// URL (MEJORAS 13): antes había un menú lateral DENTRO de una pestaña dentro de
// otra pantalla, y la configuración de la clínica estaba repartida entre dos
// sitios que no se citaban entre sí.
//
// Qué salió de aquí, por si alguien lo busca:
//   · Objetivos del mes → components/ajustes/ObjetivosMesPanel.tsx (10 ago)
//   · Plantillas        → el editor de /ajustes/configuracion; este era un
//                         SEGUNDO editor sobre la misma tabla (migración 017)
//   · Clínica y equipo  → era una copia de solo lectura de
//                         /ajustes/clinica-equipo, que sí deja editar. Borrada.
//
// El archivo conserva el historial de `components/presupuestos/ConfigAutomatizaciones.tsx`.

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
  AlertTriangle,
  Check,
  Plus,
  X,
  ICON_STROKE,
} from "../icons";
import { ErrorState } from "../ui/Feedback";
import type { UserSession, ConfiguracionAutomatizacion, ModoWhatsApp, PlantillaMensaje, TipoPlantilla, ConfigRecordatorios } from "../../lib/presupuestos/types";
import { mesISO } from "../../lib/time";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";

interface Props {
  user: UserSession;
}

type SidebarSection = "automatizaciones" | "notificaciones" | "clinica" | "whatsapp" | "recordatorios";

const DEFAULTS: Omit<ConfiguracionAutomatizacion, "clinica"> = {
  activa: true,
  diasInactividadAlerta: 3,
  diasPortalSinRespuesta: 2,
  diasReactivacion: 90,
};

type ConfigMap = Record<string, ConfiguracionAutomatizacion>;

// ─── Section ①: Automatizaciones ─────────────────────────────────────────────

export function SectionAutomatizaciones({ user }: { user: UserSession }) {
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
      // `cargarJSON` (§10). Ninguna de las dos comprobaba el status: un 500 con
      // `{error}` llegaba como objeto sin `clinicas`, el `?? []` lo convertía en
      // lista vacía y la pantalla decía que no hay clínicas.
      const [configRes, clinicasRes] = await Promise.all([
        cargarJSON<{
          configuraciones?: ConfiguracionAutomatizacion[];
          configuracion?: ConfiguracionAutomatizacion;
        }>("/api/automatizaciones/configuracion"),
        cargarJSON<{ clinicas: string[] }>("/api/presupuestos/clinicas", {
          validar: traeLista("clinicas"),
        }),
      ]);
      const map: ConfigMap = {};
      if (configRes.configuraciones) {
        for (const c of configRes.configuraciones) map[c.clinica] = c;
      } else if (configRes.configuracion) {
        map[configRes.configuracion.clinica] = configRes.configuracion;
      }
      setConfigs(map);
      setClinicas(clinicasRes.clinicas);
    } catch {
      // No se vacía `configs`: lo último bueno se conserva y el error se
      // enseña encima. Vaciar ya es perder información que sí teníamos (§10).
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

// ─── Section ②: Objetivos del mes → SE MUDÓ ─────────────────────────────────
//
// Vive en `/ajustes/objetivos` (`components/ajustes/ObjetivosMesPanel.tsx`)
// desde el 2026-08-10, primer paso de la fusión de MEJORAS 13. Era el ÚNICO
// editor de objetivos mensuales de la app y estaba escondido detrás de una
// pestaña de /automatizaciones llamada «Reglas y objetivos» que no contenía
// ninguna regla.
//
// Esta nota se queda hasta que este archivo desaparezca: quien venga buscando
// «SectionObjetivos» aquí tiene que encontrar a dónde fue, no un hueco.

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

export function SectionNotificaciones() {
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

export function SectionWhatsApp({ user }: { user: UserSession }) {
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

// ─── Section ⑥: Plantillas de Mensaje → SE BORRÓ ────────────────────────────
//
// El editor de plantillas vive AHORA SOLO en /ajustes/configuracion → Plantillas
// (MEJORAS 13, 2026-08-10). Aquí había un SEGUNDO editor sobre la MISMA tabla
// `plantillas_mensaje`, con otro idioma:
//
//   · clasificaba por `tipo` en vez de por `categoria`,
//   · escribía UNA llave ({nombre}, {doctor}) donde el renderizador de verdad
//     solo sustituye DOS ({{nombre}}, {{nombre_doctor}}), así que lo escrito
//     aquí llegaba al paciente con las llaves puestas — MEJORAS 74,
//   · y su vista previa sustituía las variables con datos inventados en el
//     cliente («María», «3.500€»), en vez de con un paciente real como hace la
//     de /ajustes.
//
// La migración 017 tradujo las filas y cerró la columna. «Generar con IA» no se
// perdió: se llevó al editor superviviente, con los prompts corregidos.
//
// La nota se queda hasta que este archivo desaparezca.

const RECORDATORIOS_DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};