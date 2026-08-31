"use client";

// La cabecera de /kpis (pasada visual 2026-07-30, bloque 2).
//
// Lo que había: una barra propia pegada al borde superior con `SubTabButton`
// —un quinto patrón de pestañas— y, dentro de cada módulo, su propia cabecera y
// su propio control. Cuatro navegaciones en la misma pantalla: los módulos
// arriba, los filtros de clínica/doctor/mes SOLO en Presupuestos, siete pestañas
// internas, y unas pills de periodo que existían en Leads y Cobros pero no en
// Presupuestos ni en No-shows. Cambiar de módulo cambiaba la forma del control.
//
// Lo que hay: la anatomía del resto del producto (título y subtítulo en el
// cuerpo, sin barra propia), el conmutador de módulo a la derecha alineado con
// el título —`SegmentedToggle`, como Cobros y Seguimiento— y UN control de
// periodo compartido por los cuatro, con el mismo vocabulario y en el mismo
// sitio. Cero primitivos nuevos.
//
// Y donde un módulo no puede honrar un filtro, se DECLARA. Un control que
// desaparece al cambiar de pestaña se lee como un fallo; uno que dice "esto aquí
// no aplica, y por qué" enseña cómo funciona el producto.

import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import type { UserSession } from "../../../lib/presupuestos/types";
import KpiView from "../../../components/presupuestos/KpiView";
import { KpisLeadsView } from "./KpisLeadsView";
import { KpisCobrosView } from "./KpisCobrosView";
import { KpisNoShowsView } from "./KpisNoShowsView";
import { SegmentedToggle } from "../../../components/shared/SegmentedToggle";
import { ColaTabs } from "../../../components/shared/ColaTabs";
import { Card } from "../../../components/ui/Card";
import {
  PERIODOS_KPI, PERIODO_DEFAULT, etiquetaComparacion, type PeriodoKpi,
} from "../../../lib/periodo";
import Link from "next/link";
import { useClinic } from "../../../lib/context/ClinicContext";
import { cargarJSON, traeLista } from "../../../lib/fetch-json";
import { AvisoFiltroClinica } from "../../../components/shared/AvisoFiltroClinica";

type SubTab = "presupuestos" | "leads" | "cobros" | "no-shows";

const MODULOS: Array<{ id: SubTab; label: string }> = [
  { id: "presupuestos", label: "Presupuestos" },
  { id: "leads", label: "Leads" },
  { id: "cobros", label: "Cobros" },
  { id: "no-shows", label: "No-shows" },
];

/** Qué sabe hacer cada módulo con los filtros comunes. Lo que no soporta se
 *  declara con su motivo — no se esconde el control. */
const SOPORTE: Record<SubTab, { doctor: boolean; nota?: string }> = {
  presupuestos: { doctor: true },
  leads: { doctor: true },
  cobros: {
    doctor: false,
    nota: "Los cobros no se atribuyen a un doctor: el pago es del paciente, no del tratamiento que lo generó.",
  },
  "no-shows": {
    doctor: false,
    nota: "El motor de no-shows está congelado; sus métricas no se pueden filtrar por doctor todavía.",
  },
};

export function KpisView({ user, isAdmin }: { user: UserSession; isAdmin: boolean }) {
  const [tab, setTab] = useState<SubTab>("presupuestos");
  const [periodo, setPeriodo] = useState<PeriodoKpi>(PERIODO_DEFAULT);
  const [doctor, setDoctor] = useState("");
  const [doctores, setDoctores] = useState<string[]>([]);
  const soporte = SOPORTE[tab];
  // La clínica NO es un control nuevo: es el selector global de la cabecera de
  // la app, el mismo que usan Leads, Cobros, Pacientes y Seguimiento. KpiView
  // tenía además el SUYO propio, un segundo desplegable de clínicas en una
  // pantalla que ya tenía uno arriba.
  const { selectedClinicaNombre, selectedClinicaId, setSelectedClinicaId } = useClinic();
  // Con clínica elegida la pantalla cambia de ámbito y hay que decirlo.
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;

  const cargarDoctores = useCallback(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (selectedClinicaNombre) url.searchParams.set("clinica", selectedClinicaNombre);
    cargarJSON<{ doctores: Array<{ nombre: string }> }>(url.toString(), {
      validar: traeLista("doctores"),
    })
      .then((d) => setDoctores(d.doctores.map((x) => x.nombre).filter(Boolean)))
      // Censo 21-08: el comentario de antes decía «se dice» y NO se decía —
      // el fallo vaciaba el filtro en silencio. Ahora se dice de verdad y se
      // CONSERVA la última lista buena (§10): vaciar es perder información.
      .catch((e) => {
        console.error("[kpis] filtro de doctores no cargado:", e);
        toast.error("No se pudo cargar el filtro de doctores — reintenta");
      });
  }, [selectedClinicaNombre]);
  useEffect(() => { cargarDoctores(); }, [cargarDoctores]);

  // Al cambiar a un módulo que no filtra por doctor, el filtro no se aplica
  // pero TAMPOCO se pierde: al volver sigue donde estaba.
  const doctorEfectivo = soporte.doctor ? doctor : "";

  return (
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-6 space-y-6 overflow-x-hidden">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
              KPIs
            </h1>
            <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
              Cómo va el negocio, por módulo y por periodo.
            </p>
          </div>
          <SegmentedToggle options={MODULOS} active={tab} onChange={setTab} />
        </div>

        {/* Fila de controles: el periodo manda en los cuatro módulos y no se
            mueve de sitio al cambiar de pestaña. */}
        <Card padding="none" className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <ColaTabs
              tabs={PERIODOS_KPI}
              active={periodo}
              onChange={(p) => setPeriodo(p as PeriodoKpi)}
            />
            <div className="flex items-center gap-2">
              <DoctorFiltro
                valor={doctor}
                onChange={setDoctor}
                opciones={doctores}
                habilitado={soporte.doctor}
                nota={soporte.nota}
              />
              {/* Enlace, no cajón (MEJORAS 81). El informe es una pantalla:
                  tiene sus propios filtros de mes y clínica, su historial, y
                  captura gráficas a PNG — cosa que un cajón que se desmonta al
                  cerrarse hacía frágil. */}
              <Link
                href="/analiticas/informes"
                className="inline-flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-semibold text-[var(--color-foreground)] shadow-sm transition-colors hover:bg-[var(--color-surface-muted)] whitespace-nowrap"
              >
                Informe mensual
              </Link>
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-muted)]">
            Las comparaciones van {etiquetaComparacion(periodo)}.
            {soporte.nota ? ` ${soporte.nota}` : ""}
          </p>
        </Card>
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

      <div>
        {tab === "presupuestos" && (
          <KpiView
            user={user}
            showBenchmark={isAdmin}
            periodo={periodo}
            doctor={doctorEfectivo}
            clinicaNombre={selectedClinicaNombre}
          />
        )}
        {tab === "leads" && <KpisLeadsView periodo={periodo} />}
        {tab === "cobros" && <KpisCobrosView periodo={periodo} />}
        {tab === "no-shows" && <KpisNoShowsView periodo={periodo} />}
      </div>

    </div>
  );
}

/** El filtro de doctor. Cuando el módulo activo no lo soporta se queda visible y
 *  deshabilitado con su motivo: desaparecer se lee como un fallo. */
function DoctorFiltro({
  valor,
  onChange,
  opciones,
  habilitado,
  nota,
}: {
  valor: string;
  onChange: (v: string) => void;
  opciones: string[];
  habilitado: boolean;
  nota?: string;
}) {
  const vacio = opciones.length === 0;
  return (
    <select
      value={habilitado ? valor : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={!habilitado || vacio}
      title={
        !habilitado ? nota
        : vacio ? "No se pudo cargar la lista de doctores"
        : "Filtrar por doctor"
      }
      className={`h-9 rounded-lg border px-2.5 text-[12.5px] font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] ${
        !habilitado || vacio
          ? "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-muted)] cursor-not-allowed"
          : valor
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]"
      }`}
    >
      <option value="">
        {!habilitado ? "Doctor · no aplica"
          : vacio ? "Doctores · no disponibles"
          : "Todos los doctores"}
      </option>
      {opciones.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  );
}

