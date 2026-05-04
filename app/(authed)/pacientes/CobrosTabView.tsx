"use client";

// Sprint 14b Bloque 2 — sub-tab "Cobros" dentro de /pacientes.
// Cola priorizada de pacientes con saldo pendiente, ordenada por
// urgencia. Es la versión OPERATIVA del Bloque 5 (KPIs Cobros) — donde
// la coordinadora trabaja, no donde mira métricas agregadas.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";

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

const URGENCIA_PILL: Record<Urgencia, string> = {
  vencido: "bg-rose-100 text-rose-700 border-rose-200",
  por_vencer: "bg-amber-100 text-amber-800 border-amber-200",
  estancado: "bg-slate-100 text-slate-700 border-slate-200",
  normal: "bg-slate-50 text-slate-500 border-slate-100",
};

type FiltroUrg = "todas" | Urgencia;
type FiltroAntig = "todo" | "hoy" | "semana" | "mes" | "antiguos";

export function CobrosTabView() {
  const { selectedClinicaId } = useClinic();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroDoctor, setFiltroDoctor] = useState<string>("");
  const [filtroUrgencia, setFiltroUrgencia] = useState<FiltroUrg>("todas");
  const [filtroAntiguedad, setFiltroAntiguedad] = useState<FiltroAntig>("todo");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    const url = new URL("/api/cola-cobros", location.href);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    if (filtroDoctor) url.searchParams.set("doctor", filtroDoctor);
    if (filtroUrgencia !== "todas") url.searchParams.set("urgencia", filtroUrgencia);
    if (filtroAntiguedad !== "todo") url.searchParams.set("antiguedad", filtroAntiguedad);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setData(d as ApiResponse))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedClinicaId, filtroDoctor, filtroUrgencia, filtroAntiguedad, reloadKey]);

  const kpis = data?.kpis;
  const items = data?.cola ?? [];

  return (
    <div className="space-y-6">
      {/* KPIs hero */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Pendientes hoy"
          value={kpis ? String(kpis.pendientesHoy) : "…"}
          tone="slate"
        />
        <KpiCard
          label="Vencidos"
          value={
            kpis
              ? `${kpis.vencidosCount} · ${fmtEUR(kpis.vencidosImporte)}`
              : "…"
          }
          tone={kpis && kpis.vencidosCount > 0 ? "rose" : "slate"}
        />
        <KpiCard
          label="Por vencer (7d)"
          value={
            kpis
              ? `${kpis.porVencerCount} · ${fmtEUR(kpis.porVencerImporte)}`
              : "…"
          }
          tone={kpis && kpis.porVencerCount > 0 ? "amber" : "slate"}
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white"
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
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white"
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
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white"
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
        <p className="text-sm text-slate-400 animate-pulse">Cargando cola…</p>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm font-semibold text-slate-700">
            Sin pendientes en este filtro.
          </p>
        </div>
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

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "rose" | "amber" | "slate";
}) {
  const valueClass =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-xl font-extrabold mt-1 ${valueClass}`}>{value}</p>
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
      setErr(e instanceof Error ? e.message : "Error abriendo WhatsApp");
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
      onMarcado();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error marcando contactado");
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
    <li className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap gap-3 items-start">
      <div className="flex-1 min-w-[220px]">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/pacientes/${item.pacienteId}`}
            className="font-semibold text-slate-900 hover:text-sky-700 hover:underline"
          >
            {item.nombre}
          </Link>
          {item.urgencia !== "normal" && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCIA_PILL[item.urgencia]}`}
            >
              {URGENCIA_LABEL[item.urgencia]}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
          {item.clinicaNombre ?? "—"} · {item.doctorNombre ?? "—"}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">{sublineUrgencia}</p>
        {item.diasDesdeUltimaContacto != null && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            Última cobranza: hace {item.diasDesdeUltimaContacto}d
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-lg font-extrabold text-rose-700 tabular-nums">
          {fmtEUR(item.pendiente)}
        </p>
        <p className="text-[11px] text-slate-400 tabular-nums">
          de {fmtEUR(item.presupuestoFirmado)}
        </p>
      </div>
      <div className="basis-full flex flex-wrap gap-2 mt-2">
        <button
          type="button"
          onClick={enviarWhatsApp}
          disabled={!tieneTelefono || busy !== null}
          title={tieneTelefono ? "WhatsApp con plantilla auto" : "Sin teléfono"}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[var(--fyllio-wa-green,_#16a34a)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "wa" ? "Abriendo…" : "📲 WhatsApp"}
        </button>
        {item.telefono && (
          <a
            href={`tel:${item.telefono.replace(/\s/g, "")}`}
            onClick={() => marcarContactado("llamada")}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
          >
            📞 Llamar
          </a>
        )}
        <button
          type="button"
          onClick={() => marcarContactado("manual")}
          disabled={busy !== null}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "marcar" ? "Guardando…" : "✓ Marcar contactado"}
        </button>
      </div>
      {err && (
        <p className="basis-full text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1 mt-1">
          {err}
        </p>
      )}
    </li>
  );
}
