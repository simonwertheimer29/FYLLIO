"use client";

// Sprint 8 Bloque C — tabla de Pacientes con KPIs + filtros.
// Sprint 14b Bloque 2 — sub-tabs "Asistidos" / "Cobros".
// Bloque 3 (2026-07-23) — tabla EDITABLE con principio "ventana, no base de
// datos": cada dato tiene UN registro origen y editar escribe ahí.
//   - Edición DIRECTA inline (guardado confirmado con toast): nombre,
//     teléfono (con propagación visible a presupuestos abiertos), email,
//     notas, doctor.
//   - Mutaciones de NEGOCIO con el modal existente de su flujo: registrar
//     cobro → PagoModal de la ficha; estado de presupuesto → mismos modales
//     y transiciones del kanban (EstadoPresupuestoFlow).
//   - Derivados (Presupuesto, Aceptado, Cobrado, Pendiente, Tratamientos,
//     Próxima cita) NO se editan: se corrigen en su origen.
//   - El icono de WhatsApp abre la conversación en la ficha, nunca wa.me.

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { Card } from "../../components/ui/Card";
import { Cifra, eur } from "../../components/shared/Cifra";
import { EmptyState } from "../../components/ui/Feedback";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";
import { MessageCircle, Users, Euro, Pencil, FileText, ChevronDown, ICON_STROKE } from "../../components/icons";
import { PagoModal } from "../../components/pacientes/PagoModal";
import NewPresupuestoModal from "../../components/presupuestos/NewPresupuestoModal";
import { EstadoPresupuestoFlow, type PresupuestoBrief } from "./EstadoPresupuestoFlow";
import { horaClinica, hoyISO, TZ_CLINICA } from "../../lib/time";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";

type Paciente = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamientos: string[];
  doctorLinkId: string | null;
  doctorNombre?: string | null;
  fechaCita: string | null;
  // Derivados en servidor (una sola verdad): dinero de presupuestos+pagos,
  // tratamientos de sus presupuestos, próxima cita de la agenda real.
  firmado: number;
  cobrado: number;
  pendienteReal: number;
  aceptadoDerivado: "Si" | "No" | "Pendiente" | null;
  tratamientosDerivados: string[];
  proximaCita: string | null;
  notas: string | null;
  canalOrigen: string | null;
  clinicaId: string | null;
  clinicaNombre?: string | null;
  leadOrigenId: string | null;
  tipoPaciente: string | null;
  activo: boolean;
  createdAt: string;
};

type Doctor = { id: string; nombre: string; clinicaId: string | null };

type DateFilter = "semana" | "mes" | "personalizado" | "todo";

/** Filas pintadas por página. */
const PAGINA_FILAS = 30;

type PresupuestoFila = PresupuestoBrief & { estado: string; fecha?: string | null };

/** Lo que se enseña al desplegar una fila. `cargando` y `error` son estados
 *  propios: un fallo no puede parecer "este paciente no tiene nada" (§4). */
type DetalleFila =
  | { estado: "cargando" }
  | { estado: "error" }
  | {
      estado: "listo";
      clinicaId: string | null;
      presupuestos: PresupuestoFila[];
      pendiente: number;
      cobrado: number;
    };

// (Aquí vivía un `fmtEUR` propio — la quinta implementación del mismo
// formateo. Ahora todo el producto usa `eur` de components/shared/Cifra.)

/** "hoy a las 19:30" · "mié 5 ago a las 19:30" — la MISMA gramática de fechas
 *  que /leads. Antes: "05/08/2026 · 19:30", que nadie lee de un vistazo.
 *  Fecha y hora DE LA CLÍNICA: el navegador de quien mira puede estar en otro
 *  huso, y una cita de las 09:00 no puede leerse como las 03:00 (MEJORAS 52). */
function fmtProximaCita(p: Paciente): string {
  const iso = p.proximaCita ?? p.fechaCita;
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const diaISO = hoyISO(d);
  const hoy = hoyISO();
  let cuando: string;
  if (diaISO === hoy) cuando = "hoy";
  else {
    const dias = Math.round(
      (new Date(`${diaISO}T12:00:00`).getTime() - new Date(`${hoy}T12:00:00`).getTime()) / 86_400_000,
    );
    cuando =
      dias === 1
        ? "mañana"
        : dias === -1
          ? "ayer"
          : d
              .toLocaleDateString("es-ES", {
                weekday: "short", day: "numeric", month: "short", timeZone: TZ_CLINICA,
              })
              .replace(",", "");
  }
  const hora = horaClinica(d);
  const conHora = iso.length > 10 && hora !== "00:00";
  return conHora ? `${cuando} a las ${hora}` : cuando;
}

// ─── Celda de texto editable inline (nivel 1: datos no sensibles) ───────
function CeldaEditable({
  valor,
  onSave,
  mono,
  placeholder,
  soloLapiz,
}: {
  valor: string | null;
  onSave: (v: string) => Promise<void>;
  mono?: boolean;
  placeholder?: string;
  /** Solo el lápiz como disparador (cuando el texto ya lo pinta otro, p. ej. el link a la ficha). */
  soloLapiz?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={soloLapiz ? "Editar" : undefined}
        className={`group inline-flex items-center gap-1 text-left hover:underline ${mono ? "text-[10px] text-[var(--color-muted)] tabular-nums" : ""}`}
      >
        {!soloLapiz && <span>{valor || placeholder || "—"}</span>}
        <Pencil
          size={10}
          strokeWidth={ICON_STROKE}
          className={`shrink-0 ${soloLapiz ? "opacity-40 hover:opacity-80" : "opacity-0 group-hover:opacity-60"}`}
          aria-hidden
        />
      </button>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={valor ?? ""}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={async (e) => {
        const v = e.target.value.trim();
        setEditing(false);
        if (v && v !== (valor ?? "")) await onSave(v);
      }}
      className="w-36 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
    />
  );
}

export function PacientesView({
  initialPacientes,
  clinicas,
  doctores,
  tiposPaciente,
  busquedaInicial = "",
}: {
  initialPacientes: Paciente[];
  clinicas: Array<{ id: string; nombre: string }>;
  doctores: Doctor[];
  /** Catálogo configurable de la clínica (Privado + sus aseguradoras). Nunca
   *  un enum: dar de alta una mutua no puede exigir un despliegue. */
  tiposPaciente: Array<{ valor: string; esAseguradora: boolean }>;
  /** ?q= de la URL: el buscador arranca con ella puesta. */
  busquedaInicial?: string;
}) {
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  // Con clínica elegida la pantalla cambia de ámbito y hay que decirlo.
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const [pacientes, setPacientes] = useState<Paciente[]>(initialPacientes);
  const [search, setSearch] = useState(busquedaInicial);
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [editingNotas, setEditingNotas] = useState<string | null>(null);
  const [editingDoctor, setEditingDoctor] = useState<string | null>(null);
  const [editingTipo, setEditingTipo] = useState<string | null>(null);
  // Carga progresiva: 166 filas de golpe eran 29.000 px de scroll. Mismo patrón
  // honesto que el kanban de Leads — se dice cuántas quedan, nada se esconde en
  // silencio. La página se reinicia al cambiar el filtro o la búsqueda.
  const [pagina, setPagina] = useState(1);
  // Flujos con modal (nivel 2: mutaciones de negocio por su flujo origen).
  const [pagoDe, setPagoDe] = useState<{ paciente: Paciente; clinicaId: string | null } | null>(null);
  const [estadoDe, setEstadoDe] = useState<{ paciente: Paciente; abiertos: PresupuestoBrief[] } | null>(null);
  const [cargandoFlujo, setCargandoFlujo] = useState<string | null>(null);
  // Segunda entrada al MISMO modal de presupuesto (spec 2026-07-29, punto 4):
  // desde una fila ya se sabe quién es el paciente, así que se abre con él
  // preseleccionado y la coordinadora se salta el paso de buscarlo. Sin
  // variantes: es el componente del kanban, con una prop de más.
  const [presupuestoDe, setPresupuestoDe] = useState<Paciente | null>(null);
  const [presupuestoNuevo, setPresupuestoNuevo] = useState(false);
  // Fila expandible (2026-07-29): un RESUMEN ACCIONABLE corto, no una
  // mini-ficha. Si creciera hasta duplicar la ficha sobraría una de las dos, así
  // que aquí solo cabe lo que se responde de un vistazo —qué presupuestos tiene
  // y cuánto debe— y los dos botones que ya existen.
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, DetalleFila>>({});

  const filtered = useMemo(() => {
    let out = pacientes;
    if (selectedClinicaId) out = out.filter((p) => p.clinicaId === selectedClinicaId);
    if (dateFilter !== "todo") {
      const now = new Date();
      const from = new Date(now);
      if (dateFilter === "semana") from.setDate(from.getDate() - 7);
      else if (dateFilter === "mes") from.setDate(from.getDate() - 30);
      out = out.filter((p) => new Date(p.createdAt) >= from);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      out = out.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.telefono ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [pacientes, selectedClinicaId, dateFilter, search]);

  // KPIs — sobre los DERIVADOS (presupuestos+pagos), no sobre los campos
  // manuales/cache del paciente, que divergían.
  //
  // LA TASA SE MIDE SOBRE QUIEN RECIBIÓ PRESUPUESTO, no sobre todos los
  // pacientes. Decía "41% del total" con 166 en el denominador, de los que 46
  // nunca recibieron ninguno: la aceptación real era el 57%. Numerador ⊂
  // denominador, y los que aún no han decidido se declaran — misma regla que la
  // conversión de /red (pasada visual 2026-07-29).
  const total = filtered.length;
  const conPresupuesto = filtered.filter((p) => p.aceptadoDerivado !== null);
  const base = conPresupuesto.length;
  const aceptados = conPresupuesto.filter((p) => p.aceptadoDerivado === "Si").length;
  const noAceptados = conPresupuesto.filter((p) => p.aceptadoDerivado === "No").length;
  const abiertos = conPresupuesto.filter((p) => p.aceptadoDerivado === "Pendiente").length;
  const sinPresupuesto = total - base;
  const cobrado = filtered.reduce((s, p) => s + (p.cobrado ?? 0), 0);
  const pendienteTotal = filtered.reduce((s, p) => s + (p.pendienteReal ?? 0), 0);
  const pctAceptados = base ? Math.round((aceptados / base) * 100) : null;
  const pctNoAceptados = base ? Math.round((noAceptados / base) * 100) : null;

  // Ajuste durante el render (patrón oficial de React): si cambia el conjunto
  // filtrado, la página vuelve a la primera sin pasar por un efecto.
  const [filtroPrevio, setFiltroPrevio] = useState("");
  const claveFiltro = `${selectedClinicaId}|${dateFilter}|${search}`;
  if (filtroPrevio !== claveFiltro) {
    setFiltroPrevio(claveFiltro);
    setPagina(1);
  }
  const visibles = filtered.slice(0, pagina * PAGINA_FILAS);
  const restantes = filtered.length - visibles.length;

  // PATCH al registro origen (paciente) — solo campos de la whitelist del
  // servidor. Devuelve presupuestosActualizados para nombrar la cascada.
  async function patch(id: string, body: Record<string, any>): Promise<number | null> {
    const res = await fetch(`/api/pacientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(d?.error ?? "No se pudo guardar — inténtalo de nuevo");
      return null;
    }
    const doctorName = d.paciente.doctorLinkId
      ? doctores.find((x) => x.id === d.paciente.doctorLinkId)?.nombre ?? null
      : null;
    const clinicaName = d.paciente.clinicaId
      ? clinicas.find((c) => c.id === d.paciente.clinicaId)?.nombre ?? null
      : null;
    // Merge sobre la fila existente: el PATCH devuelve el paciente almacenado
    // SIN los derivados (firmado/cobrado/…), que deben sobrevivir al update.
    setPacientes((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...d.paciente, doctorNombre: doctorName, clinicaNombre: clinicaName } : p
      )
    );
    return typeof d.presupuestosActualizados === "number" ? d.presupuestosActualizados : 0;
  }

  /** La ficha de un paciente. Los TRES sitios que la piden pasan por aquí, y
   *  por `cargarJSON`, que lanza en vez de devolver una lista vacía (§10).
   *  Antes cada uno la leía a su manera y los tres tenían un `?? []` sobre
   *  `presupuestos`: uno hacía `return` en silencio tras una mutación —la fila
   *  se quedaba con las cifras de antes, sin avisar—, otro lo pintaba como
   *  paciente sin presupuestos, y el tercero enseñaba «HTTP 500». */
  async function cargarFicha(id: string) {
    return cargarJSON<{
      paciente?: { clinicaId?: string | null };
      presupuestos: unknown[];
      kpisPagos?: { pendiente?: number; totalFacturado?: number; firmado?: number };
    }>(`/api/pacientes/${id}`, { validar: traeLista("presupuestos") });
  }

  // Refresca los DERIVADOS de una fila tras una mutación de negocio (cobro,
  // estado): relee la ficha y recalcula con sus presupuestos/pagos reales.
  async function refrescarFila(id: string) {
    try {
      const d = await cargarFicha(id);
      const presus = d.presupuestos as Array<{ estado: string; tratamiento: string | null }>;
      const nAcept = presus.filter((x) => x.estado === "ACEPTADO").length;
      const nPerd = presus.filter((x) => x.estado === "PERDIDO").length;
      const nVivos = presus.length - nAcept - nPerd;
      const trats = [
        ...new Set(
          presus
            .filter((x) => x.estado !== "PERDIDO")
            .flatMap((x) => (x.tratamiento ?? "").split(/[,+]/).map((t) => t.trim()))
            .filter(Boolean),
        ),
      ];
      setPacientes((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                firmado: d.kpisPagos?.firmado ?? 0,
                cobrado: d.kpisPagos?.totalFacturado ?? 0,
                pendienteReal: d.kpisPagos?.pendiente ?? 0,
                aceptadoDerivado: nAcept > 0 ? "Si" : nVivos > 0 ? "Pendiente" : nPerd > 0 ? "No" : null,
                tratamientosDerivados: trats,
              }
            : p,
        ),
      );
    } catch {
      /* la próxima carga completa reconcilia */
    }
  }

  // Carga la ficha para los flujos de negocio (clinicaId real + presupuestos).
  /** Abre o cierra la fila, cargando su detalle la primera vez. */
  async function alternarFila(p: Paciente) {
    if (expandido === p.id) { setExpandido(null); return; }
    setExpandido(p.id);
    if (detalles[p.id]) return;
    setDetalles((prev) => ({ ...prev, [p.id]: { estado: "cargando" } }));
    try {
      const d = await cargarFicha(p.id);
      setDetalles((prev) => ({
        ...prev,
        [p.id]: {
          estado: "listo",
          clinicaId: d.paciente?.clinicaId ?? null,
          presupuestos: d.presupuestos as PresupuestoFila[],
          pendiente: (d.kpisPagos?.pendiente ?? 0) as number,
          cobrado: (d.kpisPagos?.totalFacturado ?? 0) as number,
        },
      }));
    } catch {
      // Un fallo NO se pinta como "este paciente no tiene nada" (§4).
      setDetalles((prev) => ({ ...prev, [p.id]: { estado: "error" } }));
    }
  }

  async function cargarDetalle(id: string) {
    try {
      const d = await cargarFicha(id);
      return {
        clinicaId: d.paciente?.clinicaId ?? null,
        presupuestos: d.presupuestos as Array<PresupuestoBrief & { estado: string }>,
      };
    } catch (e) {
      toast.error(mensajeDeError(e));
      return null;
    }
  }

  async function abrirRegistrarCobro(p: Paciente) {
    setCargandoFlujo(p.id);
    const det = await cargarDetalle(p.id);
    setCargandoFlujo(null);
    if (!det) return;
    setPagoDe({ paciente: p, clinicaId: det.clinicaId });
  }

  async function abrirEstadoPresupuesto(p: Paciente) {
    setCargandoFlujo(p.id);
    const det = await cargarDetalle(p.id);
    setCargandoFlujo(null);
    if (!det) return;
    const abiertos = det.presupuestos.filter(
      (x) => x.estado !== "ACEPTADO" && x.estado !== "PERDIDO",
    );
    if (det.presupuestos.length === 0) {
      toast.info("Sin presupuestos — créalo desde el módulo de Presupuestos");
      return;
    }
    if (abiertos.length === 0) {
      toast.info("Sin presupuestos abiertos — los cerrados se corrigen desde el kanban o la ficha");
      return;
    }
    setEstadoDe({ paciente: p, abiertos });
  }

  return (
    // Página que FLUYE (23-08): el scroll lo pone el wrapper del shell. El
    // `flex-1 min-h-0 overflow-auto` del layout viejo la convertía en columna
    // de alto fijo, y la card de la tabla —flex item con overflow-hidden, que
    // ANULA su altura mínima de contenido— se encogía al hueco restante y
    // RECORTABA la tabla en vez de generar scroll (medido: 2.617px→397px).
    <div className="flex flex-col bg-[var(--color-background)] p-6 gap-4">
      <header>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Pacientes
        </h1>
        {/* El subtítulo dice QUÉ es esta pantalla. "Pacientes asistidos" no lo
            decía, y "en el periodo seleccionado" hablaba de un periodo con el
            filtro puesto en "Todo". */}
        <p className="text-xs text-[var(--color-muted)] mt-0.5">
          Todo el que ya es paciente de la clínica, con su dinero y su próxima cita.
          {dateFilter !== "todo" && " Filtrado por fecha de alta."}
        </p>
      </header>
      {/* El filtro de clínica PERSISTE en localStorage: se puede llegar
          aquí con él puesto sin haberlo tocado en esta sesión, y las cifras
          son otras. Se declara en la página, no solo en el selector. */}
      {clinicaFiltrada && (
        <AvisoFiltroClinica
          nombre={selectedClinicaNombre!}
          onVerTodas={() => setSelectedClinicaId(null)}
        />
      )}

      {/* Franja compacta, como en /cobros: cuatro cards de 100 px empujaban la
          primera fila 1.000 px hacia abajo en móvil, y el importe se salía de
          su card. El color se reserva para lo que compara — un recuento no es
          bueno ni malo, así que fuera el verde y el rojo de la cabecera. */}
      <Card padding="none" className="px-5 py-3.5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Cifra label="Pacientes" valor={String(total)} detalle={`${base} con presupuesto`} />
          <Cifra
            label="Aceptaron"
            valor={pctAceptados == null ? "—" : `${pctAceptados}%`}
            detalle={base ? `${aceptados} de ${base}${abiertos > 0 ? ` · ${abiertos} aún sin decidir` : ""}` : "sin presupuestos"}
          />
          <Cifra
            label="No aceptaron"
            valor={pctNoAceptados == null ? "—" : `${pctNoAceptados}%`}
            detalle={base ? `${noAceptados} de ${base}` : "sin presupuestos"}
          />
          {/* Los que están decidiéndose AHORA: es el trabajo pendiente, no una
              foto del pasado como los otros dos porcentajes. */}
          <Cifra
            label="Decidiendo"
            valor={String(abiertos)}
            detalle={abiertos === 1 ? "presupuesto abierto" : "presupuestos abiertos"}
          />
          <Cifra
            label="Cobrado"
            valor={eur(cobrado)}
            detalle={`${eur(pendienteTotal)} pendiente`}
          />
        </div>
        {sinPresupuesto > 0 && (
          <p className="text-[11px] text-[var(--color-muted)] mt-2.5 pt-2.5 border-t border-[var(--color-border)]">
            Los porcentajes se miden sobre los {base} pacientes que recibieron presupuesto.
            Los otros {sinPresupuesto} todavía no han recibido ninguno.
          </p>
        )}
      </Card>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([
            ["todo", "Todo"],
            ["semana", "Esta semana"],
            ["mes", "Este mes"],
            ["personalizado", "Personalizado"],
          ] as Array<[DateFilter, string]>).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setDateFilter(k)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                dateFilter === k
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Buscar paciente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        {/* Crear presupuesto también desde arriba: si la coordinadora ya sabe a
            quién, no tiene por qué buscar su fila primero. Es el MISMO modal,
            aquí sin paciente preseleccionado. */}
        <button
          type="button"
          onClick={() => setPresupuestoNuevo(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-1.5 text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <FileText size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Nuevo presupuesto
        </button>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-muted)] text-[10px] uppercase tracking-wider">
              <tr>
                <Th>Paciente</Th>
                <Th>Tratamientos</Th>
                <Th>Doctor</Th>
                <Th>Tipo</Th>
                <Th>Próxima cita</Th>
                <Th>Firmado</Th>
                <Th>Presupuesto</Th>
                <Th>Cobrado</Th>
                <Th>Pendiente</Th>
                <Th>Notas</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p, i) => {
                const doctoresDeClinica = p.clinicaId
                  ? doctores.filter((d) => d.clinicaId === p.clinicaId)
                  : doctores;
                const abierta = expandido === p.id;
                return (
                  <Fragment key={p.id}>
                  <tr
                    onClick={(e) => {
                      // Solo si el clic no era para otra cosa (enlace, botón,
                      // celda editable): la fila entera es el disparador, pero
                      // no se come las acciones que ya tenía.
                      if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
                      void alternarFila(p);
                    }}
                    aria-expanded={abierta}
                    className={`border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] fyllio-fade-in cursor-pointer ${
                      abierta ? "bg-[var(--color-surface-muted)]" : ""
                    }`}
                    style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                  >
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          size={12}
                          strokeWidth={ICON_STROKE}
                          aria-hidden
                          className={`shrink-0 text-[var(--color-muted)] transition-transform ${abierta ? "" : "-rotate-90"}`}
                        />
                        <Link
                          href={`/pacientes/${p.id}`}
                          className="font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline transition-colors"
                        >
                          {p.nombre}
                        </Link>
                        <CeldaEditable
                          valor={p.nombre}
                          soloLapiz
                          onSave={async (v) => {
                            if (await patch(p.id, { nombre: v }) !== null) toast.success("Nombre guardado");
                          }}
                        />
                      </div>
                      <CeldaEditable
                        valor={p.telefono}
                        mono
                        placeholder="añadir teléfono"
                        onSave={async (v) => {
                          const n = await patch(p.id, { telefono: v });
                          if (n !== null) {
                            toast.success(
                              n > 0
                                ? `Teléfono guardado — actualizado en ${n} presupuesto${n === 1 ? "" : "s"} abierto${n === 1 ? "" : "s"}`
                                : "Teléfono guardado",
                            );
                          }
                        }}
                      />
                      <div>
                        <CeldaEditable
                          valor={p.email}
                          mono
                          placeholder="añadir email"
                          onSave={async (v) => {
                            if (await patch(p.id, { email: v }) !== null) toast.success("Email guardado");
                          }}
                        />
                      </div>
                      {p.canalOrigen && (
                        <span className="mt-1 inline-flex rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-2 py-0.5 text-[9px] font-semibold">
                          {p.canalOrigen}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {/* DERIVADO de sus presupuestos (no perdidos); la columna
                          propia del paciente es copia a deprecar. */}
                      <div className="flex flex-wrap gap-1">
                        {p.tratamientosDerivados.length === 0 && <span className="text-[var(--color-muted)]">—</span>}
                        {p.tratamientosDerivados.map((t) => (
                          <span
                            key={t}
                            className="inline-flex rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-2 py-0.5 text-[10px] font-semibold"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {editingDoctor === p.id ? (
                        <select
                          autoFocus
                          value={p.doctorLinkId ?? ""}
                          onChange={async (e) => {
                            const id = e.target.value || null;
                            setEditingDoctor(null);
                            if (await patch(p.id, { doctorLinkId: id }) !== null) {
                              toast.success(id ? "Doctor asignado" : "Doctor desasignado");
                            }
                          }}
                          onBlur={() => setEditingDoctor(null)}
                          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-xs"
                        >
                          <option value="">—</option>
                          {doctoresDeClinica.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.nombre}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingDoctor(p.id)}
                          className="text-[var(--color-foreground)] hover:underline"
                        >
                          {p.doctorNombre ?? "—"}
                        </button>
                      )}
                    </Td>
                    {/* Privado / aseguradora — propiedad de la persona, edición
                        directa como el doctor (dato no sensible, Bloque 3). */}
                    <Td>
                      {editingTipo === p.id ? (
                        <select
                          autoFocus
                          value={p.tipoPaciente ?? ""}
                          onChange={async (e) => {
                            const v = e.target.value || null;
                            setEditingTipo(null);
                            if (await patch(p.id, { tipoPaciente: v }) !== null) {
                              toast.success(v ? `Tipo: ${v}` : "Tipo sin asignar");
                            }
                          }}
                          onBlur={() => setEditingTipo(null)}
                          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-xs"
                        >
                          <option value="">Sin tipo</option>
                          {tiposPaciente.map((t) => (
                            <option key={t.valor} value={t.valor}>{t.valor}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingTipo(p.id)}
                          aria-label={`Cambiar tipo de ${p.nombre}`}
                        >
                          <TipoPacienteChip valor={p.tipoPaciente} tipos={tiposPaciente} />
                        </button>
                      )}
                    </Td>
                    {/* Próxima cita REAL desde la agenda (derivado; el campo
                        suelto del paciente solo queda como respaldo). */}
                    <Td>{fmtProximaCita(p)}</Td>
                    {/* Dinero DERIVADO: presupuesto firmado (Σ ACEPTADO),
                        aceptación según presupuestos reales, cobrado (Σ pagos)
                        y su resta. Se corrigen en su origen, no aquí. */}
                    <Td>{p.firmado > 0 ? eur(p.firmado) : "—"}</Td>
                    <Td>
                      <button
                        type="button"
                        disabled={cargandoFlujo === p.id}
                        onClick={() => abrirEstadoPresupuesto(p)}
                        title="Cambiar el estado del presupuesto origen (mismo flujo que el kanban)"
                        className="group inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <EstadoPresupuestoChip estado={p.aceptadoDerivado} />
                        <Pencil
                          size={10}
                          strokeWidth={ICON_STROKE}
                          className="opacity-0 group-hover:opacity-60"
                          aria-hidden
                        />
                      </button>
                    </Td>
                    <Td>{p.cobrado > 0 ? eur(p.cobrado) : "—"}</Td>
                    <Td>{p.pendienteReal > 0 ? eur(p.pendienteReal) : "—"}</Td>
                    <Td>
                      {editingNotas === p.id ? (
                        <textarea
                          autoFocus
                          defaultValue={p.notas ?? ""}
                          onBlur={async (e) => {
                            const v = e.target.value;
                            setEditingNotas(null);
                            if (v !== (p.notas ?? "")) {
                              if (await patch(p.id, { notas: v }) !== null) toast.success("Notas guardadas");
                            }
                          }}
                          className="w-48 min-h-[50px] text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingNotas(p.id)}
                          className="text-[var(--color-muted)] text-left line-clamp-2 max-w-[180px] hover:underline"
                        >
                          {p.notas || "—"}
                        </button>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={cargandoFlujo === p.id}
                          onClick={() => abrirRegistrarCobro(p)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:opacity-50"
                          title="Registrar cobro (modal de pago de la ficha)"
                          aria-label={`Registrar cobro de ${p.nombre}`}
                        >
                          <Euro size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresupuestoDe(p)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] transition-colors"
                          title="Crear presupuesto para este paciente"
                          aria-label={`Crear presupuesto para ${p.nombre}`}
                        >
                          <FileText size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        </button>
                        {/* La conversación vive en la ficha (hilo + registro);
                            nunca wa.me directo desde la tabla. */}
                        <Link
                          href={`/pacientes/${p.id}`}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--fyllio-wa-green)] hover:bg-[var(--color-surface-muted)] transition-colors"
                          title="Abrir conversación en la ficha"
                          aria-label={`Abrir conversación con ${p.nombre}`}
                        >
                          <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        </Link>
                      </div>
                    </Td>
                  </tr>
                  {abierta && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                      <td colSpan={11} className="px-5 py-3">
                        <ResumenPaciente
                          paciente={p}
                          detalle={detalles[p.id]}
                          onCrearPresupuesto={() => setPresupuestoDe(p)}
                          onRegistrarCobro={() => void abrirRegistrarCobro(p)}
                          onReintentar={() => {
                            setDetalles((prev) => {
                              const s = { ...prev };
                              delete s[p.id];
                              return s;
                            });
                            setExpandido(null);
                            void alternarFila(p);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-4">
                    <EmptyState
                      icon={<Users size={24} strokeWidth={ICON_STROKE} />}
                      title="Sin pacientes en el filtro actual"
                      hint="Ajusta los filtros o la búsqueda para ver resultados."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {restantes > 0 && (
          <button
            type="button"
            onClick={() => setPagina((n) => n + 1)}
            className="w-full border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            Ver {Math.min(restantes, PAGINA_FILAS)} más · quedan {restantes} de {filtered.length}
          </button>
        )}
      </div>

      {/* Registrar cobro — el MISMO PagoModal de la ficha (registro origen:
          el pago). Al cerrar con éxito se refrescan los derivados de la fila. */}
      {pagoDe && (
        <PagoModal
          mode="create"
          pacienteId={pagoDe.paciente.id}
          clinicaId={pagoDe.clinicaId}
          onClose={() => setPagoDe(null)}
          onDone={() => {
            setPagoDe(null);
            toast.success("Cobro registrado — actualizado en Presupuestos y Cobros");
            void refrescarFila(pagoDe.paciente.id);
          }}
        />
      )}

      {/* Nuevo presupuesto sobre un paciente que ya existe — el caso que hasta
          hoy no se podía hacer: era la mitad del negocio de una clínica real. */}
      {presupuestoDe && (
        <NewPresupuestoModal
          user={{ rol: "admin", clinica: presupuestoDe.clinicaNombre ?? null }}
          pacienteInicial={{
            id: presupuestoDe.id,
            nombre: presupuestoDe.nombre,
            telefono: presupuestoDe.telefono,
            clinicaId: presupuestoDe.clinicaId,
            clinicaNombre: presupuestoDe.clinicaNombre ?? null,
          }}
          onClose={() => setPresupuestoDe(null)}
          onCreated={() => {
            setPresupuestoDe(null);
            toast.success("Presupuesto creado — ya está en Presupuestos y en su ficha");
            void refrescarFila(presupuestoDe.id);
          }}
        />
      )}

      {/* El mismo modal, sin paciente preseleccionado: se busca dentro. */}
      {presupuestoNuevo && (
        <NewPresupuestoModal
          user={{ rol: "admin", clinica: null }}
          onClose={() => setPresupuestoNuevo(false)}
          onCreated={() => {
            setPresupuestoNuevo(false);
            toast.success("Presupuesto creado — ya está en Presupuestos y en su ficha");
          }}
        />
      )}

      {/* Estado de presupuesto — mismos modales y transiciones del kanban. */}
      {estadoDe && (
        <EstadoPresupuestoFlow
          pacienteNombre={estadoDe.paciente.nombre}
          presupuestosAbiertos={estadoDe.abiertos}
          onClose={() => setEstadoDe(null)}
          onMutado={() => void refrescarFila(estadoDe.paciente.id)}
        />
      )}
    </div>
  );
}

/**
 * El resumen que aparece al desplegar una fila. CORTO a propósito: responde
 * "¿qué tiene abierto y cuánto debe?" y ofrece las dos acciones que ya existen.
 * Todo lo demás —conversación, historial, pagos uno a uno— vive en la ficha, y
 * "Ver ficha completa" lleva ahí. Si esto creciera hasta duplicar la ficha,
 * sobraría una de las dos.
 */
function ResumenPaciente({
  paciente,
  detalle,
  onCrearPresupuesto,
  onRegistrarCobro,
  onReintentar,
}: {
  paciente: Paciente;
  detalle: DetalleFila | undefined;
  onCrearPresupuesto: () => void;
  onRegistrarCobro: () => void;
  onReintentar: () => void;
}) {
  if (!detalle || detalle.estado === "cargando") {
    return <p className="text-[11px] text-[var(--color-muted)]">Cargando…</p>;
  }
  if (detalle.estado === "error") {
    return (
      <p className="text-[11px] text-[var(--color-danger)]">
        No se pudo cargar la información de {paciente.nombre}.{" "}
        <button type="button" onClick={onReintentar} className="font-semibold underline">
          Reintentar
        </button>
      </p>
    );
  }
  const abiertos = detalle.presupuestos.filter(
    (x) => x.estado !== "ACEPTADO" && x.estado !== "PERDIDO",
  );
  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors";
  return (
    <div className="flex flex-col lg:flex-row lg:items-start gap-4">
      <div className="min-w-0 flex-1">
        {detalle.presupuestos.length === 0 ? (
          <p className="text-[11px] text-[var(--color-muted)]">
            Todavía no tiene ningún presupuesto.
          </p>
        ) : (
          <ul className="space-y-1">
            {detalle.presupuestos.slice(0, 4).map((pr) => (
              <li key={pr.id} className="flex items-center gap-2 text-[11px]">
                <EstadoPresupuestoChip
                  estado={
                    pr.estado === "ACEPTADO" ? "Si" : pr.estado === "PERDIDO" ? "No" : "Pendiente"
                  }
                />
                <span className="text-[var(--color-foreground)] truncate">
                  {pr.tratamiento ?? "Sin tratamiento"}
                </span>
                <span className="ml-auto tabular-nums text-[var(--color-foreground)] shrink-0">
                  {pr.importe != null ? eur(pr.importe) : "—"}
                </span>
              </li>
            ))}
            {detalle.presupuestos.length > 4 && (
              <li className="text-[11px] text-[var(--color-muted)]">
                y {detalle.presupuestos.length - 4} más
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="shrink-0 text-[11px] tabular-nums lg:w-44">
        <p className="text-[var(--color-muted)]">
          Cobrado <span className="text-[var(--color-foreground)] font-medium">{eur(detalle.cobrado)}</span>
        </p>
        <p className={detalle.pendiente > 0 ? "text-[var(--color-danger)] font-medium" : "text-[var(--color-muted)]"}>
          {detalle.pendiente > 0 ? `${eur(detalle.pendiente)} pendiente` : "Sin pendiente"}
        </p>
        {abiertos.length > 0 && (
          <p className="text-[var(--color-muted)] mt-0.5">
            {abiertos.length} {abiertos.length === 1 ? "decidiéndose" : "decidiéndose"}
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-wrap gap-1.5">
        <button type="button" onClick={onCrearPresupuesto} className={btn}>
          <FileText size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Nuevo presupuesto
        </button>
        <button type="button" onClick={onRegistrarCobro} className={btn}>
          <Euro size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Registrar cobro
        </button>
        <Link href={`/pacientes/${paciente.id}`} className={btn}>
          Ver ficha completa
        </Link>
      </div>
    </div>
  );
}

/** Los CUATRO estados que de verdad tiene la columna, dichos por su nombre.
 *  Se llamaba "Aceptado" con valores Sí / No / Pendiente / — : una cabecera que
 *  se lee binaria sobre algo que no lo es, y que además colapsa seis estados de
 *  presupuesto. "Sin presupuesto" pierde el pill: un borde vacío repetido 46
 *  veces es ruido, y el hueco ya dice lo que pasa. */
function EstadoPresupuestoChip({ estado }: { estado: "Si" | "No" | "Pendiente" | null }) {
  if (estado === null) {
    return <span className="text-[var(--color-muted)]">Sin presupuesto</span>;
  }
  const estilo =
    estado === "Si"
      ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
      : estado === "No"
        ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
        : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  const texto = estado === "Si" ? "Aceptado" : estado === "No" ? "Perdido" : "Abierto";
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${estilo}`}>
      {texto}
    </span>
  );
}

/** Chip del tipo. "Sin tipo" NO se esconde: es un estado real y el hueco es
 *  justo lo que invita a rellenarlo. La aseguradora se distingue del privado
 *  por peso, no por un color nuevo — el acento sigue reservado a la acción. */
function TipoPacienteChip({
  valor,
  tipos,
}: {
  valor: string | null;
  tipos: Array<{ valor: string; esAseguradora: boolean }>;
}) {
  if (!valor) {
    return (
      <span className="inline-flex rounded-md border border-dashed border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">
        Sin tipo
      </span>
    );
  }
  const esAseg = tipos.find((t) => t.valor === valor)?.esAseguradora ?? false;
  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
        esAseg
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
      }`}
      title={esAseg ? `Aseguradora: ${valor}` : valor}
    >
      {valor}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top text-[var(--color-foreground)]">{children}</td>;
}
