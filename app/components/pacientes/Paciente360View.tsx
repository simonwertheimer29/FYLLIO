"use client";

// app/components/pacientes/Paciente360View.tsx
// Sprint 14a Bloque 1.5 — vista 360 del paciente como hub central.
//
// Carga TODO en una sola llamada a /api/pacientes/[id] (paciente, lead
// origen, presupuestos, pagos, acciones, kpis, próxima cita,
// usuariosNombres). 5 tabs: Resumen / Presupuestos / Pagos / Acciones /
// Notas.
//
// Convive en paralelo al componente legacy bajo
// app/components/presupuestos/Paciente360View.tsx (este se carga via
// nombre, ese vía pacienteId). El redirect legacy resuelve el id y
// trae al usuario aquí; el legacy queda como fallback histórico.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Pago, TipoPago, MetodoPago } from "../../lib/pagos";
import { formatTipo } from "../../lib/pagos";
import { CardListSkeleton, KpiCardSkeleton } from "../ui/Skeleton";

// Sprint 14a Bloque 6 — re-scope a 3 hitos comerciales.
const TIPOS_PAGO_OPTS: Array<{ value: TipoPago; label: string; help: string }> = [
  {
    value: "Senal",
    label: "Señal",
    help: "Anticipo al firmar el presupuesto. Inicia el compromiso del paciente.",
  },
  {
    value: "Primer_Pago_Plan",
    label: "Primer pago de plan",
    help: "Primer movimiento del plan de pagos. Arranca el tratamiento.",
  },
  {
    value: "Liquidacion",
    label: "Liquidación",
    help: "Pago final del importe restante.",
  },
];
const METODOS_PAGO_OPTS: MetodoPago[] = [
  "Efectivo",
  "Tarjeta",
  "Transferencia",
  "Bizum",
  "Financiacion",
  "Otro",
];

// ─── Tipos del payload del endpoint ────────────────────────────────────

type PacientePayload = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  clinicaId: string | null;
  tratamientos: string[];
  doctorLinkId: string | null;
  fechaCita: string | null;
  presupuestoTotal: number | null;
  aceptado: "Si" | "No" | "Pendiente" | null;
  pagado: number | null;
  pendienteCache: number | null;
  financiado: number | null;
  notas: string | null;
  canalOrigen: string | null;
  leadOrigenId: string | null;
  activo: boolean;
  createdAt: string;
};

type LeadPayload = {
  id: string;
  nombre: string;
  estado: string;
  canal: string | null;
  tratamiento: string | null;
  createdAt: string;
  doctorAsignadoId: string | null;
  fechaCita: string | null;
} | null;

type PresupuestoPayload = {
  id: string;
  estado: string;
  importe: number | null;
  fecha: string | null;
  fechaAlta: string | null;
  fechaAceptado: string | null;
  doctor: string | null;
  tratamiento: string | null;
  notas: string | null;
};

type AccionPayload = {
  id: string;
  leadId: string;
  tipo: string;
  timestamp: string;
  usuarioId: string | null;
  detalles: string | null;
};

type Paciente360Payload = {
  paciente: PacientePayload;
  lead: LeadPayload;
  presupuestos: PresupuestoPayload[];
  pagos: Pago[];
  acciones: AccionPayload[];
  usuariosNombres: Record<string, string>;
  kpisPagos: {
    totalFacturado: number;
    pendiente: number | null;
    numPagos: number;
    ultimoPagoHaceDias: number | null;
  };
  proximaCita: string | null;
};

type TabKey = "resumen" | "presupuestos" | "pagos" | "acciones" | "notas";

// ─── Helpers de formato ────────────────────────────────────────────────

function formatFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatFechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

const TIPO_PAGO_DOT: Record<string, string> = {
  Pago_Unico: "bg-sky-500",
  Cuota: "bg-amber-500",
  Senal: "bg-violet-500",
  Liquidacion: "bg-emerald-500",
};

// Sprint 14b Bloque 0 — label de TipoPago centralizado en lib/pagos
// (formatTipo). El mapa local quedó deprecado.

const ESTADO_PRESUPUESTO_COLOR: Record<string, string> = {
  ACEPTADO: "bg-emerald-100 text-emerald-700",
  PRESENTADO: "bg-sky-100 text-sky-700",
  INTERESADO: "bg-violet-100 text-violet-700",
  EN_DUDA: "bg-amber-100 text-amber-700",
  PERDIDO: "bg-rose-100 text-rose-700",
  REACTIVADO: "bg-blue-100 text-blue-700",
};

const TIPO_ACCION_ICON: Record<string, string> = {
  Llamada: "📞",
  WhatsApp_Saliente: "📤",
  WhatsApp_Entrante: "📥",
  Cambio_Estado: "→",
  Nota: "📝",
};

function resolveUsuario(
  id: string | null | undefined,
  map: Record<string, string>,
): string {
  if (!id) return "Coordinación";
  return map[id] ?? "Usuario eliminado";
}

// ─── Componente principal ──────────────────────────────────────────────

export default function Paciente360View({ pacienteId }: { pacienteId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Paciente360Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  // Sprint 14a Bloque 6 — modales CRUD pago.
  const [pagoModal, setPagoModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; pago: Pago }
    | { mode: "delete"; pago: Pago }
    | null
  >(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pacientes/${pacienteId}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
        const json = (await res.json()) as Paciente360Payload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Error al cargar paciente");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [pacienteId, reloadKey]);

  const tabCounts = useMemo(() => {
    if (!data) return { presupuestos: 0, pagos: 0, acciones: 0 };
    return {
      presupuestos: data.presupuestos.length,
      pagos: data.pagos.length,
      acciones: data.acciones.length,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6 max-w-3xl mx-auto space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
        <CardListSkeleton rows={4} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-sm text-rose-700">No se pudo cargar el paciente.</p>
        {error && <p className="text-xs text-rose-500">{error}</p>}
        <button
          onClick={() => router.back()}
          className="text-xs text-slate-500 underline hover:text-slate-800"
        >
          ← Volver
        </button>
      </div>
    );
  }

  const { paciente, lead, presupuestos, pagos, acciones, usuariosNombres, kpisPagos, proximaCita } =
    data;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header sticky */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-700 text-sm font-medium flex items-center gap-1"
        >
          ← Volver
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">{paciente.nombre}</p>
          <p className="text-[11px] text-slate-400">
            {paciente.telefono ?? "Sin teléfono"}
            {paciente.canalOrigen && ` · ${paciente.canalOrigen}`}
            {lead && ` · Origen lead`}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          <TabButton
            label="Resumen"
            active={activeTab === "resumen"}
            onClick={() => setActiveTab("resumen")}
          />
          <TabButton
            label="Presupuestos"
            count={tabCounts.presupuestos}
            active={activeTab === "presupuestos"}
            onClick={() => setActiveTab("presupuestos")}
          />
          <TabButton
            label="Pagos"
            count={tabCounts.pagos}
            active={activeTab === "pagos"}
            onClick={() => setActiveTab("pagos")}
          />
          <TabButton
            label="Acciones"
            count={tabCounts.acciones}
            active={activeTab === "acciones"}
            onClick={() => setActiveTab("acciones")}
          />
          <TabButton
            label="Notas"
            active={activeTab === "notas"}
            onClick={() => setActiveTab("notas")}
          />
        </div>

        {activeTab === "resumen" && (
          <ResumenTab
            paciente={paciente}
            lead={lead}
            presupuestos={presupuestos}
            kpisPagos={kpisPagos}
            proximaCita={proximaCita}
          />
        )}
        {activeTab === "presupuestos" && (
          <PresupuestosTab presupuestos={presupuestos} />
        )}
        {activeTab === "pagos" && (
          <PagosTab
            pagos={pagos}
            kpis={kpisPagos}
            usuariosNombres={usuariosNombres}
            paciente={paciente}
            onCreate={() => setPagoModal({ mode: "create" })}
            onEdit={(p) => setPagoModal({ mode: "edit", pago: p })}
            onDelete={(p) => setPagoModal({ mode: "delete", pago: p })}
          />
        )}
        {activeTab === "acciones" && (
          <AccionesTab acciones={acciones} usuariosNombres={usuariosNombres} />
        )}
        {activeTab === "notas" && (
          <NotasTab paciente={paciente} presupuestos={presupuestos} />
        )}
      </div>

      {/* Modales CRUD pago — Sprint 14a Bloque 6 */}
      {pagoModal?.mode === "create" && (
        <PagoModal
          mode="create"
          pacienteId={paciente.id}
          clinicaId={paciente.clinicaId}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {pagoModal?.mode === "edit" && (
        <PagoModal
          mode="edit"
          pacienteId={paciente.id}
          clinicaId={paciente.clinicaId}
          pago={pagoModal.pago}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {pagoModal?.mode === "delete" && (
        <DeletePagoDialog
          pacienteId={paciente.id}
          pago={pagoModal.pago}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

// ─── Tab button ────────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active
          ? "text-slate-900 border-slate-900"
          : "text-slate-500 border-transparent hover:text-slate-700"
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-semibold">
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Resumen tab ───────────────────────────────────────────────────────

function ResumenTab({
  paciente,
  lead,
  presupuestos,
  kpisPagos,
  proximaCita,
}: {
  paciente: PacientePayload;
  lead: LeadPayload;
  presupuestos: PresupuestoPayload[];
  kpisPagos: Paciente360Payload["kpisPagos"];
  proximaCita: string | null;
}) {
  const presupuestosAceptados = presupuestos.filter((p) => p.estado === "ACEPTADO").length;
  const fmtEUR = (n: number) => `€${n.toLocaleString("es-ES")}`;
  return (
    <div className="space-y-6">
      {/* KPIs principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Presupuestos" value={String(presupuestos.length)} sub={`${presupuestosAceptados} aceptados`} />
        <Card
          label="Total facturado"
          value={fmtEUR(kpisPagos.totalFacturado)}
          sub={`${kpisPagos.numPagos} pagos`}
        />
        <Card
          label="Pendiente"
          value={kpisPagos.pendiente == null ? "—" : fmtEUR(kpisPagos.pendiente)}
          rose={kpisPagos.pendiente != null && kpisPagos.pendiente > 0}
        />
        <Card
          label="Próxima cita"
          value={proximaCita ? formatFechaCorta(proximaCita) : "—"}
        />
      </div>

      {/* Datos básicos */}
      <Section title="Datos">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <KV k="Teléfono" v={paciente.telefono ?? "—"} />
          <KV k="Email" v={paciente.email ?? "—"} />
          <KV k="Tratamientos" v={paciente.tratamientos.join(", ") || "—"} />
          <KV k="Canal origen" v={paciente.canalOrigen ?? "—"} />
          <KV k="Activo" v={paciente.activo ? "Sí" : "No"} />
          <KV k="Alta" v={formatFecha(paciente.createdAt)} />
        </div>
      </Section>

      {/* Lead origen */}
      {lead && (
        <Section title="Origen lead">
          <div className="text-sm space-y-1">
            <p className="text-slate-700">
              <span className="font-medium">{lead.nombre}</span> · {lead.canal ?? "Canal desconocido"}
              {lead.tratamiento && ` · interés: ${lead.tratamiento}`}
            </p>
            <p className="text-xs text-slate-500">
              Captado {formatFecha(lead.createdAt)} · Estado actual: {lead.estado}
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  rose,
}: {
  label: string;
  value: string;
  sub?: string;
  rose?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
      <p className={`text-2xl font-extrabold ${rose ? "text-rose-700" : "text-slate-900"}`}>
        {value}
      </p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
        {title}
      </p>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-slate-400 uppercase tracking-wide">{k}</span>
      <span className="text-slate-700">{v}</span>
    </div>
  );
}

// ─── Presupuestos tab ──────────────────────────────────────────────────

function PresupuestosTab({ presupuestos }: { presupuestos: PresupuestoPayload[] }) {
  if (presupuestos.length === 0) {
    return (
      <Empty icon="📋" titulo="Sin presupuestos" texto="Este paciente no tiene presupuestos creados." />
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
        Presupuestos ({presupuestos.length})
      </p>
      <div className="divide-y divide-slate-50">
        {presupuestos.map((p) => {
          const colorClass =
            ESTADO_PRESUPUESTO_COLOR[p.estado] ?? "bg-slate-100 text-slate-600";
          return (
            <div key={p.id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}
                  >
                    {p.estado}
                  </span>
                  {p.fechaAceptado && (
                    <span className="text-[10px] text-slate-400">
                      Aceptado {formatFechaCorta(p.fechaAceptado)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-700 mt-1 truncate">
                  {p.tratamiento ?? "Sin tratamiento"}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {formatFecha(p.fechaAlta ?? p.fecha)}
                  {p.doctor && ` · ${p.doctor}`}
                </p>
              </div>
              {p.importe != null && (
                <p className="text-sm font-bold text-slate-800 shrink-0">
                  €{p.importe.toLocaleString("es-ES")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pagos tab ─────────────────────────────────────────────────────────

function PagosTab({
  pagos,
  kpis,
  usuariosNombres,
  paciente,
  onCreate,
  onEdit,
  onDelete,
}: {
  pagos: Pago[];
  kpis: Paciente360Payload["kpisPagos"];
  usuariosNombres: Record<string, string>;
  paciente: PacientePayload;
  onCreate: () => void;
  onEdit: (pago: Pago) => void;
  onDelete: (pago: Pago) => void;
}) {
  const fmtEUR = (n: number) => `€${n.toLocaleString("es-ES")}`;
  const ultimoLabel = (() => {
    if (kpis.ultimoPagoHaceDias == null) return "—";
    if (kpis.ultimoPagoHaceDias === 0) return "hoy";
    if (kpis.ultimoPagoHaceDias === 1) return "hace 1 día";
    return `hace ${kpis.ultimoPagoHaceDias} días`;
  })();
  const pendienteTooltip =
    kpis.pendiente == null
      ? !paciente.presupuestoTotal || paciente.presupuestoTotal === 0
        ? "Sin presupuesto aceptado todavía"
        : "Pendiente de aceptación de presupuesto"
      : undefined;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total facturado" value={fmtEUR(kpis.totalFacturado)} />
        <div
          className="bg-white rounded-2xl border border-slate-200 p-4 text-center"
          title={pendienteTooltip}
        >
          <p
            className={`text-2xl font-extrabold ${
              kpis.pendiente != null && kpis.pendiente > 0
                ? "text-rose-700"
                : kpis.pendiente == null
                ? "text-slate-400 cursor-help"
                : "text-slate-900"
            }`}
          >
            {kpis.pendiente == null ? "—" : fmtEUR(kpis.pendiente)}
          </p>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">
            Pendiente
          </p>
        </div>
        <Card label="Nº pagos" value={String(kpis.numPagos)} />
        <Card label="Último pago" value={ultimoLabel} />
      </div>

      {/* Banner de posicionamiento — Sprint 14a Bloque 6 */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
        Fyllio registra los <span className="font-semibold text-slate-700">hitos comerciales</span> del cobro
        (señal, primer pago de plan, liquidación). Los pagos intermedios del tratamiento
        se gestionan en tu software clínico (Gesden u otro).
      </div>

      <div className="flex justify-end">
        <button
          onClick={onCreate}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
        >
          + Registrar pago
        </button>
      </div>

      {pagos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div className="text-3xl mb-2">💳</div>
          <p className="text-sm font-semibold text-slate-700">Sin pagos registrados</p>
          <p className="text-xs text-slate-400 mt-1">
            El historial financiero del paciente aparecerá aquí.
          </p>
          <button
            onClick={onCreate}
            className="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Registrar primer pago
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
            Historial ({pagos.length})
          </p>
          <div className="divide-y divide-slate-50">
            {pagos.map((p, i) => {
              const isMigrated = (p.nota ?? "").includes("[MIGRADO Sprint 13.1]");
              return (
                <div
                  key={p.id}
                  className="px-4 py-3 flex items-start gap-3 group fyllio-fade-in"
                  style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
                >
                  <span
                    className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${TIPO_PAGO_DOT[p.tipo] ?? "bg-slate-400"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-base font-bold text-slate-900">
                        €{p.importe.toLocaleString("es-ES")}
                      </p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {formatTipo(p.tipo)}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-100">
                        {p.metodo}
                      </span>
                      {isMigrated && (
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
                          title="Pago histórico migrado, edita con cuidado."
                        >
                          migrado
                        </span>
                      )}
                    </div>
                    {p.nota && (
                      <p className="text-xs text-slate-600 italic mt-1 line-clamp-2">{p.nota}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">
                      Registrado por {resolveUsuario(p.usuarioCreadorId, usuariosNombres)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs text-slate-500 font-medium">
                      {formatFecha(p.fechaPago)}
                    </p>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onEdit(p)}
                        className="text-[10px] text-slate-500 hover:text-slate-900 px-1.5 py-0.5 rounded hover:bg-slate-100"
                        title="Editar pago"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => onDelete(p)}
                        className="text-[10px] text-rose-500 hover:text-rose-700 px-1.5 py-0.5 rounded hover:bg-rose-50"
                        title="Eliminar pago"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modales CRUD pago — Sprint 14a Bloque 6 ───────────────────────────

function PagoModal({
  mode,
  pacienteId,
  clinicaId,
  pago,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  pacienteId: string;
  /** Sprint 14b Bloque 0 — clínica del paciente para cargar métodos
   *  configurados (con fallback global). Si null, usamos lista hardcoded. */
  clinicaId: string | null;
  pago?: Pago;
  onClose: () => void;
  onDone: () => void;
}) {
  const [importe, setImporte] = useState<string>(
    pago ? String(pago.importe) : "",
  );
  const [fechaPago, setFechaPago] = useState<string>(
    pago?.fechaPago ?? new Date().toISOString().slice(0, 10),
  );
  const [metodo, setMetodo] = useState<string>(pago?.metodo ?? "Tarjeta");
  const [tipo, setTipo] = useState<TipoPago>(pago?.tipo ?? "Senal");
  const [nota, setNota] = useState<string>(pago?.nota ?? "");
  const [submitting, setSubmitting] = useState(false);
  // Sprint 14b Bloque 0 — métodos de pago desde Configuraciones_Clinica
  // (con fallback a global si la clínica no customizó). Mientras carga,
  // usamos METODOS_PAGO_OPTS del enum como respaldo.
  const [metodosDisp, setMetodosDisp] = useState<string[]>(
    METODOS_PAGO_OPTS.slice(),
  );
  useEffect(() => {
    let cancelled = false;
    const target = clinicaId ?? "global";
    fetch(`/api/configuraciones/${target}?categoria=Metodos_Pago`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.opciones) return;
        const valores = (j.opciones as Array<{ valor: string }>).map((o) => o.valor);
        if (valores.length > 0) setMetodosDisp(valores);
      })
      .catch(() => {
        // Fallback al hardcoded; ya está seteado.
      });
    return () => {
      cancelled = true;
    };
  }, [clinicaId]);
  const [error, setError] = useState<string | null>(null);

  const isMigrated = pago && (pago.nota ?? "").includes("[MIGRADO Sprint 13.1]");
  const tipoCfg = TIPOS_PAGO_OPTS.find((t) => t.value === tipo);

  async function handleSubmit() {
    const importeNum = Number(importe.replace(",", "."));
    if (!Number.isFinite(importeNum) || importeNum <= 0) {
      setError("Importe debe ser un número > 0");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      setError("Fecha inválida (YYYY-MM-DD)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url =
        mode === "create"
          ? `/api/pacientes/${pacienteId}/pagos`
          : `/api/pacientes/${pacienteId}/pagos/${pago!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importe: importeNum,
          fechaPago,
          metodo,
          tipo,
          nota: nota || undefined,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">
            {mode === "create" ? "Registrar pago" : "Editar pago"}
          </h3>
          {isMigrated && (
            <p className="text-[11px] text-amber-700 mt-1">
              ⚠ Pago histórico migrado, edita con cuidado.
            </p>
          )}
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
                Importe (€)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
                Fecha
              </label>
              <input
                type="date"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
                Método
              </label>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
              >
                {/* Sprint 14b Bloque 0 — métodos de pago configurables
                    por clínica via Configuraciones_Clinica. Si el método
                    actual del pago en edición no está en la lista (caso
                    legacy o método deshabilitado), lo añadimos al final
                    para que se vea en lugar de aparentar 'no
                    seleccionado'. */}
                {!metodosDisp.includes(metodo) && metodo && (
                  <option value={metodo}>{metodo}</option>
                )}
                {metodosDisp.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
                Tipo
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoPago)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
              >
                {TIPOS_PAGO_OPTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {tipoCfg && (
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">{tipoCfg.help}</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
              Nota (opcional)
            </label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none resize-none"
            />
          </div>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting
              ? "Guardando…"
              : mode === "create"
              ? "Guardar pago"
              : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeletePagoDialog({
  pacienteId,
  pago,
  onClose,
  onDone,
}: {
  pacienteId: string;
  pago: Pago;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pacientes/${pacienteId}/pagos/${pago.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
      setSubmitting(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5">
        <h3 className="font-semibold text-slate-900 text-sm">¿Eliminar este pago?</h3>
        <p className="text-xs text-slate-600 mt-2">
          Pago de <span className="font-semibold">€{pago.importe.toLocaleString("es-ES")}</span>{" "}
          del {formatFecha(pago.fechaPago)} ({formatTipo(pago.tipo)}).
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Esta acción ajustará el total pagado del paciente.
        </p>
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {submitting ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Acciones tab ──────────────────────────────────────────────────────

function AccionesTab({
  acciones,
  usuariosNombres,
}: {
  acciones: AccionPayload[];
  usuariosNombres: Record<string, string>;
}) {
  if (acciones.length === 0) {
    return (
      <Empty
        icon="📞"
        titulo="Sin acciones registradas"
        texto="Las llamadas, mensajes y notas del lead origen aparecerán aquí."
      />
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
        Actividad ({acciones.length})
      </p>
      <div className="divide-y divide-slate-50">
        {acciones.map((a) => (
          <div key={a.id} className="px-4 py-3 flex gap-3 items-start">
            <span className="text-base mt-0.5 shrink-0 w-5 text-center">
              {TIPO_ACCION_ICON[a.tipo] ?? "·"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700">{a.tipo.replace("_", " ")}</p>
              {a.detalles && <p className="text-xs text-slate-600 mt-0.5">{a.detalles}</p>}
              <p className="text-[10px] text-slate-400 mt-0.5">
                por {resolveUsuario(a.usuarioId, usuariosNombres)}
              </p>
            </div>
            <p className="text-[10px] text-slate-400 shrink-0">
              {formatFechaCorta(a.timestamp)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Notas tab ─────────────────────────────────────────────────────────

function NotasTab({
  paciente,
  presupuestos,
}: {
  paciente: PacientePayload;
  presupuestos: PresupuestoPayload[];
}) {
  const presupuestosConNotas = presupuestos.filter((p) => p.notas);
  const tieneAlgo = paciente.notas || presupuestosConNotas.length > 0;
  if (!tieneAlgo) {
    return <Empty icon="📝" titulo="Sin notas" texto="Aún no hay anotaciones registradas." />;
  }
  return (
    <div className="space-y-4">
      {paciente.notas && (
        <Section title="Nota del paciente">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{paciente.notas}</p>
        </Section>
      )}
      {presupuestosConNotas.map((p) => (
        <Section
          key={p.id}
          title={`Nota de presupuesto · ${p.tratamiento ?? "Sin tratamiento"}`}
        >
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{p.notas}</p>
        </Section>
      ))}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────

function Empty({ icon, titulo, texto }: { icon: string; titulo: string; texto: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="text-xs text-slate-400 mt-1">{texto}</p>
    </div>
  );
}
