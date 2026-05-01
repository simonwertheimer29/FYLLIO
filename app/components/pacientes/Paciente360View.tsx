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
import type { Pago } from "../../lib/pagos";

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

const TIPO_PAGO_LABEL: Record<string, string> = {
  Pago_Unico: "Pago único",
  Cuota: "Cuota",
  Senal: "Señal",
  Liquidacion: "Liquidación",
};

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
  }, [pacienteId]);

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm animate-pulse">Cargando paciente…</p>
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
          />
        )}
        {activeTab === "acciones" && (
          <AccionesTab acciones={acciones} usuariosNombres={usuariosNombres} />
        )}
        {activeTab === "notas" && (
          <NotasTab paciente={paciente} presupuestos={presupuestos} />
        )}
      </div>
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
}: {
  pagos: Pago[];
  kpis: Paciente360Payload["kpisPagos"];
  usuariosNombres: Record<string, string>;
  paciente: PacientePayload;
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

      <div className="flex justify-end">
        <button
          disabled
          title="Disponible cuando se cierre el Bloque 6 (CRUD pagos)."
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        >
          + Registrar pago
        </button>
      </div>

      {pagos.length === 0 ? (
        <Empty icon="💳" titulo="Sin pagos registrados" texto="El historial financiero del paciente aparecerá aquí." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-3 text-xs font-bold text-slate-700 border-b border-slate-100 uppercase tracking-wide">
            Historial ({pagos.length})
          </p>
          <div className="divide-y divide-slate-50">
            {pagos.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-start gap-3">
                <span
                  className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${TIPO_PAGO_DOT[p.tipo] ?? "bg-slate-400"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-base font-bold text-slate-900">
                      €{p.importe.toLocaleString("es-ES")}
                    </p>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {TIPO_PAGO_LABEL[p.tipo] ?? p.tipo}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-100">
                      {p.metodo}
                    </span>
                  </div>
                  {p.nota && (
                    <p className="text-xs text-slate-600 italic mt-1 line-clamp-2">{p.nota}</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    Registrado por {resolveUsuario(p.usuarioCreadorId, usuariosNombres)}
                  </p>
                </div>
                <p className="text-xs text-slate-500 shrink-0 font-medium">
                  {formatFecha(p.fechaPago)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
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
