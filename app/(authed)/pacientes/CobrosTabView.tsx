"use client";

// Sprint 14b Bloque 2 — sub-tab "Cobros" dentro de /pacientes.
// Cola priorizada de pacientes con saldo pendiente, ordenada por
// urgencia. Es la versión OPERATIVA del Bloque 5 (KPIs Cobros) — donde
// la coordinadora trabaja, no donde mira métricas agregadas.

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { CardListSkeleton, KpiCardSkeleton } from "../../components/ui/Skeleton";
import { KpiCard } from "../../components/ui/KpiCard";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { StatePill, type StatePillVariant } from "../../components/ui/StatePill";
import { MessageCircle, Phone, Check, Inbox, ICON_STROKE } from "../../components/icons";

type Urgencia = "vencido" | "por_vencer" | "estancado" | "normal";

type ColaItem = {
  pacienteId: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorLinkId: string | null;
  doctorNombre: string | null;
  presupuestoFirmado: number;
  pagado: number;
  pendiente: number;
  fechaAceptado: string | null;
  diasDesdeAceptacion: number | null;
  plazoDias: number;
  diasVencido: number | null;
  diasParaVencer: number | null;
  urgencia: Urgencia;
  numPagos: number;
  ultimaContactoCobranzaISO: string | null;
  diasDesdeUltimaContacto: number | null;
};

type ApiResponse = {
  kpis: {
    pendientesHoy: number;
    vencidosCount: number;
    vencidosImporte: number;
    porVencerCount: number;
    porVencerImporte: number;
  };
  cola: ColaItem[];
  doctoresDisponibles: Array<{ id: string; nombre: string }>;
};

const fmtEUR = (n: number) =>
  `€${n.toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  })}`;

const URGENCIA_LABEL: Record<Urgencia, string> = {
  vencido: "Vencido",
  por_vencer: "Por vencer",
  estancado: "Estancado",
  normal: "—",
};

const URGENCIA_VARIANT: Record<Urgencia, StatePillVariant> = {
  vencido: "danger",
  por_vencer: "warning",
  estancado: "neutral",
  normal: "neutral",
};

type FiltroUrg = "todas" | Urgencia;
type FiltroAntig = "todo" | "hoy" | "semana" | "mes" | "antiguos";

const SELECT_CLASS =
  "text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]";

export function CobrosTabView() {
  const { selectedClinicaId } = useClinic();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroDoctor, setFiltroDoctor] = useState<string>("");
  const [filtroUrgencia, setFiltroUrgencia] = useState<FiltroUrg>("todas");
  const [filtroAntiguedad, setFiltroAntiguedad] = useState<FiltroAntig>("todo");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = new URL("/api/cola-cobros", location.href);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    if (filtroDoctor) url.searchParams.set("doctor", filtroDoctor);
    if (filtroUrgencia !== "todas") url.searchParams.set("urgencia", filtroUrgencia);
    if (filtroAntiguedad !== "todo") url.searchParams.set("antiguedad", filtroAntiguedad);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setData(d as ApiResponse))
      .catch(() => {
        setData(null);
        setError("No se pudieron cargar los cobros.");
      })
      .finally(() => setLoading(false));
  }, [selectedClinicaId, filtroDoctor, filtroUrgencia, filtroAntiguedad, reloadKey]);

  const kpis = data?.kpis;
  const items = data?.cola ?? [];

  if (error) {
    return (
      <div className="space-y-6">
        <ErrorState
          detail="Los cobros no se han podido cargar."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs hero */}
      {!kpis ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="Pendientes hoy" value={kpis.pendientesHoy} accent="neutral" />
          <KpiCard
            label="Vencidos"
            value={kpis.vencidosCount}
            subline={fmtEUR(kpis.vencidosImporte)}
            accent={kpis.vencidosCount > 0 ? "rose" : "neutral"}
          />
          <KpiCard
            label="Por vencer (7d)"
            value={kpis.porVencerCount}
            subline={fmtEUR(kpis.porVencerImporte)}
            accent={kpis.porVencerCount > 0 ? "amber" : "neutral"}
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Todos los doctores</option>
          {(data?.doctoresDisponibles ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
        <select
          value={filtroUrgencia}
          onChange={(e) => setFiltroUrgencia(e.target.value as FiltroUrg)}
          className={SELECT_CLASS}
        >
          <option value="todas">Todas las urgencias</option>
          <option value="vencido">Vencido</option>
          <option value="por_vencer">Por vencer</option>
          <option value="estancado">Estancado</option>
          <option value="normal">Sin urgencia</option>
        </select>
        <select
          value={filtroAntiguedad}
          onChange={(e) => setFiltroAntiguedad(e.target.value as FiltroAntig)}
          className={SELECT_CLASS}
        >
          <option value="todo">Toda antigüedad</option>
          <option value="hoy">Hoy</option>
          <option value="semana">Esta semana</option>
          <option value="mes">Este mes</option>
          <option value="antiguos">Más antiguos (&gt;30d)</option>
        </select>
      </div>

      {/* Cola */}
      {loading && !data ? (
        <CardListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox size={24} strokeWidth={ICON_STROKE} />}
          title="Sin cobros pendientes en este filtro"
          hint="Cuando un paciente tenga saldo por cobrar, aparecerá aquí. Prueba a cambiar los filtros."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <div
              key={it.pacienteId}
              className="fyllio-fade-in"
              style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
            >
              <CobroCard
                item={it}
                onMarcado={() => setReloadKey((k) => k + 1)}
              />
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}

function CobroCard({
  item,
  onMarcado,
}: {
  item: ColaItem;
  onMarcado: () => void;
}) {
  const [busy, setBusy] = useState<"wa" | "marcar" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function enviarWhatsApp() {
    setBusy("wa");
    setErr(null);
    try {
      const res = await fetch(
        `/api/cola-cobros/${item.pacienteId}/recordatorio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urgencia: item.urgencia }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      const j = await res.json();
      if (!j.telefono) throw new Error("Paciente sin teléfono");
      const tel = String(j.telefono).replace(/\D/g, "");
      const body = encodeURIComponent(String(j.mensaje ?? ""));
      window.open(`https://wa.me/${tel}?text=${body}`, "_blank");
      // Auto-marcar como contactado tras abrir WA.
      await marcarContactado("whatsapp");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo abrir WhatsApp");
      toast.error("No se pudo abrir WhatsApp");
    } finally {
      setBusy(null);
    }
  }

  async function marcarContactado(canal: "whatsapp" | "llamada" | "manual") {
    setBusy("marcar");
    setErr(null);
    try {
      const res = await fetch(
        `/api/cola-cobros/${item.pacienteId}/marcar-contactado`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canal }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      toast.success("Marcado como contactado");
      onMarcado();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo marcar como contactado");
      toast.error("No se pudo marcar como contactado");
    } finally {
      setBusy(null);
    }
  }

  const tieneTelefono = !!item.telefono;
  const sublineUrgencia = (() => {
    if (item.urgencia === "vencido" && item.diasVencido != null) {
      return `Vencido hace ${item.diasVencido}d`;
    }
    if (item.urgencia === "por_vencer" && item.diasParaVencer != null) {
      return `Vence en ${item.diasParaVencer}d`;
    }
    if (item.urgencia === "estancado") {
      return `Aceptado hace ${item.diasDesdeAceptacion ?? "?"}d sin pagos`;
    }
    return item.diasDesdeAceptacion != null
      ? `Aceptado hace ${item.diasDesdeAceptacion}d`
      : "Sin fecha";
  })();

  return (
    <li className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 flex flex-wrap gap-3 items-start">
      <div className="flex-1 min-w-[220px]">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/pacientes/${item.pacienteId}`}
            className="font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline"
          >
            {item.nombre}
          </Link>
          {item.urgencia !== "normal" && (
            <StatePill variant={URGENCIA_VARIANT[item.urgencia]} size="sm">
              {URGENCIA_LABEL[item.urgencia]}
            </StatePill>
          )}
        </div>
        <p className="text-[11px] text-[var(--color-muted)] mt-0.5 truncate">
          {item.clinicaNombre ?? "—"} · {item.doctorNombre ?? "—"}
        </p>
        <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{sublineUrgencia}</p>
        {item.diasDesdeUltimaContacto != null && (
          <p className="text-[10px] text-[var(--color-muted)] mt-0.5">
            Último contacto de cobro: hace {item.diasDesdeUltimaContacto}d
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="font-display text-lg font-bold text-[var(--color-danger)] tabular-nums">
          {fmtEUR(item.pendiente)}
        </p>
        <p className="text-[11px] text-[var(--color-muted)] tabular-nums">
          de {fmtEUR(item.presupuestoFirmado)}
        </p>
      </div>
      <div className="basis-full flex flex-wrap gap-2 mt-2">
        <button
          type="button"
          onClick={enviarWhatsApp}
          disabled={!tieneTelefono || busy !== null}
          title={tieneTelefono ? "Enviar WhatsApp con plantilla" : "Sin teléfono"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
          {busy === "wa" ? "Abriendo…" : "WhatsApp"}
        </button>
        {item.telefono && (
          <a
            href={`tel:${item.telefono.replace(/\s/g, "")}`}
            onClick={() => marcarContactado("llamada")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Llamar
          </a>
        )}
        <button
          type="button"
          onClick={() => marcarContactado("manual")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[var(--color-surface)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors"
        >
          <Check size={14} strokeWidth={ICON_STROKE} aria-hidden />
          {busy === "marcar" ? "Guardando…" : "Marcar contactado"}
        </button>
      </div>
      {err && (
        <p className="basis-full text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded px-2 py-1 mt-1">
          {err}
        </p>
      )}
    </li>
  );
}
