"use client";

// app/(authed)/ajustes/configuracion/ConfiguracionView.tsx
// Sprint 14b Bloque 0 — panel admin para gestionar
// Configuraciones_Clinica con 4 categorías:
//   Métodos de pago, Plazos de liquidación, Razones No Interesado,
//   Plantillas WhatsApp scope (placeholder; lo cierra Bloque 4).
//
// El admin elige scope (Globales o una clínica concreta) y por cada
// categoría puede añadir/desactivar/editar opciones. Las globales
// siempre se muestran como referencia incluso cuando se está editando
// una clínica (badge "default").

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { ErrorState } from "../../../components/ui/Feedback";
import { AlertTriangle, Target, ICON_STROKE } from "../../../components/icons";
import { HorarioLaboralPanel } from "./HorarioLaboralPanel";
import { LlamadasIaPanel } from "./LlamadasIaPanel";
import { MotorNoShowsPanel } from "./MotorNoShowsPanel";

type Scope = "global" | string; // "global" o clinicaId

type Categoria =
  | "Metodos_Pago"
  | "Plazos_Liquidacion"
  | "Razones_No_Interesado"
  | "Plantillas_Scope"
  | "Horario_Laboral"
  | "Llamadas_IA"
  | "Motor_NoShows";

type Opcion = {
  id: string;
  clinicaId: string | null;
  categoria: Categoria;
  valor: string;
  activo: boolean;
  orden: number;
  createdAt: string;
};

const TABS: Array<{ key: Categoria; label: string; help: string }> = [
  {
    key: "Metodos_Pago",
    label: "Métodos de pago",
    help: "Lista de métodos disponibles al registrar un pago. La clínica hereda los globales si no añade ninguno.",
  },
  {
    key: "Plazos_Liquidacion",
    label: "Plazos de liquidación",
    help: "Días por defecto entre que el paciente acepta presupuesto y se espera la liquidación. Las alertas automáticas usan este valor (default 90 días).",
  },
  {
    key: "Razones_No_Interesado",
    label: "Razones \"No Interesado\"",
    help: "Frases que la coordinadora selecciona al transicionar un lead a No Interesado.",
  },
  {
    key: "Plantillas_Scope",
    label: "Plantillas WhatsApp",
    help: "Plantillas de mensajes por categoría. Las globales sirven de referencia; cada clínica puede crear las suyas.",
  },
  {
    key: "Horario_Laboral",
    label: "Horario laboral",
    help: "Días y horas en los que esta clínica permite envíos automáticos. Las acciones del motor de automatizaciones que envíen WhatsApp respetan este horario.",
  },
  {
    key: "Llamadas_IA",
    label: "Llamadas IA",
    help: "Configuración de las llamadas IA salientes: activación por clínica, ventana horaria, mensaje personalizado, voz y límite por día.",
  },
  {
    key: "Motor_NoShows",
    label: "Motor No-shows",
    help: "Motor de predicción de no-shows: activación de predicción, llamada IA automática para riesgo alto, plantillas extra y umbral de riesgo. Las salvaguardas (opt-out, cooldown, horario laboral) se aplican automáticamente.",
  },
];

export default function ConfiguracionView({
  clinicas,
}: {
  clinicas: Array<{ id: string; nombre: string }>;
}) {
  const [scope, setScope] = useState<Scope>("global");
  const [categoria, setCategoria] = useState<Categoria>("Metodos_Pago");
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Carga: include all (globales + propias) para que el admin vea
  // los defaults aunque la clínica ya haya customizado. Horario_Laboral
  // tiene su propio panel y endpoint, no usa la lista de opciones.
  useEffect(() => {
    if (
      categoria === "Horario_Laboral" ||
      categoria === "Llamadas_IA" ||
      categoria === "Motor_NoShows"
    ) {
      setOpciones([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/configuraciones/${scope}?all=true&categoria=${categoria}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (cancelled) return;
        setOpciones(j.opciones ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error al cargar");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope, categoria, reloadKey]);

  const opcionesPropias = opciones.filter((o) =>
    scope === "global" ? o.clinicaId === null : o.clinicaId === scope,
  );
  const opcionesGlobales = opciones.filter((o) => o.clinicaId === null);
  const mostrandoGlobales = scope === "global";
  const heredanGlobal = !mostrandoGlobales && opcionesPropias.length === 0;

  const tab = useMemo(() => TABS.find((t) => t.key === categoria)!, [categoria]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Configuración</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Adapta Fyllio a la forma de trabajar de cada clínica. Los valores por defecto son la
          referencia inicial; cuando una clínica añade su propia opción, sustituye los valores
          por defecto en esa categoría para esa clínica.
        </p>
      </div>

      {/* Scope selector */}
      <Card className="flex items-center gap-4 flex-wrap">
        <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
          Ámbito
        </label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          <option value="global">Valores por defecto</option>
          {clinicas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {!mostrandoGlobales && (
          <span className="text-[11px] text-[var(--color-muted)]">
            {heredanGlobal
              ? "Esta clínica hereda los valores por defecto en esta categoría."
              : `${opcionesPropias.length} opciones propias.`}
          </span>
        )}
      </Card>

      {/* Tabs categoría */}
      <div className="flex gap-1 border-b border-[var(--color-border)] overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setCategoria(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
              categoria === t.key
                ? "text-[var(--color-accent)] border-[var(--color-accent)]"
                : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-foreground)]"
            }`}
          >
            {t.key === "Motor_NoShows" && (
              <Target size={14} strokeWidth={ICON_STROKE} aria-hidden />
            )}
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-[var(--color-muted)]">{tab.help}</p>

      {categoria === "Horario_Laboral" ? (
        scope === "global" ? (
          <Card padding="none" className="p-6 text-sm text-[var(--color-muted)]">
            El horario laboral se configura por clínica. Cambia el ámbito arriba a una clínica concreta para editarlo.
          </Card>
        ) : (
          <HorarioLaboralPanel clinicaId={scope} />
        )
      ) : categoria === "Llamadas_IA" ? (
        scope === "global" ? (
          <Card padding="none" className="p-6 text-sm text-[var(--color-muted)]">
            Las llamadas IA se configuran por clínica. Cambia el ámbito arriba a una clínica concreta para editarlas.
          </Card>
        ) : (
          <LlamadasIaPanel clinicaId={scope} />
        )
      ) : categoria === "Motor_NoShows" ? (
        <MotorNoShowsPanel clinicaId={scope} />
      ) : loading ? (
        <p className="text-sm text-[var(--color-muted)] animate-pulse">Cargando opciones…</p>
      ) : error ? (
        <ErrorState
          detail="Las opciones de esta categoría no están disponibles ahora mismo."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <CategoriaPanel
          scope={scope}
          categoria={categoria}
          opcionesPropias={opcionesPropias}
          opcionesGlobales={opcionesGlobales}
          heredanGlobal={heredanGlobal}
          mostrandoGlobales={mostrandoGlobales}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

// ─── Panel por categoría ───────────────────────────────────────────────

function CategoriaPanel({
  scope,
  categoria,
  opcionesPropias,
  opcionesGlobales,
  heredanGlobal,
  mostrandoGlobales,
  onChanged,
}: {
  scope: Scope;
  categoria: Categoria;
  opcionesPropias: Opcion[];
  opcionesGlobales: Opcion[];
  heredanGlobal: boolean;
  mostrandoGlobales: boolean;
  onChanged: () => void;
}) {
  const [nuevoValor, setNuevoValor] = useState("");
  const [submittingNew, setSubmittingNew] = useState(false);

  async function handleAdd() {
    const valor = nuevoValor.trim();
    if (!valor) return;
    setSubmittingNew(true);
    try {
      const orden =
        opcionesPropias.length > 0
          ? Math.max(...opcionesPropias.map((o) => o.orden)) + 1
          : 1;
      const res = await fetch(`/api/configuraciones/${scope}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, valor, orden }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      setNuevoValor("");
      toast.success("Opción añadida");
      onChanged();
    } catch {
      toast.error("No se pudo añadir la opción. Inténtalo de nuevo.");
    } finally {
      setSubmittingNew(false);
    }
  }

  // Plazos: input single-value en lugar de lista.
  if (categoria === "Plazos_Liquidacion") {
    return (
      <PlazoSinglePanel
        scope={scope}
        opcionesPropias={opcionesPropias}
        opcionesGlobales={opcionesGlobales}
        heredanGlobal={heredanGlobal}
        mostrandoGlobales={mostrandoGlobales}
        onChanged={onChanged}
      />
    );
  }

  if (categoria === "Plantillas_Scope") {
    // Sprint 14b Bloque 4 — UI funcional de plantillas. El scope viene
    // de la prop `scope` del wrapper (global o clinicaId).
    return <PlantillasPanel scope={scope} />;
  }

  return (
    <div className="space-y-4">
      <Card padding="none" className="overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
            {mostrandoGlobales
              ? "Opciones globales"
              : heredanGlobal
              ? "Heredando valores por defecto"
              : "Opciones de esta clínica"}
          </p>
          <p className="text-[11px] text-[var(--color-muted)]">
            {opcionesPropias.length === 0 && !mostrandoGlobales
              ? `${opcionesGlobales.length} valor${opcionesGlobales.length === 1 ? "" : "es"} por defecto`
              : `${opcionesPropias.length} ${opcionesPropias.length === 1 ? "opción" : "opciones"}`}
          </p>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {(opcionesPropias.length === 0 && !mostrandoGlobales
            ? opcionesGlobales
            : opcionesPropias
          ).map((o) => (
            <OpcionRow
              key={o.id}
              opcion={o}
              isGlobalReference={!mostrandoGlobales && o.clinicaId === null}
              onChanged={onChanged}
            />
          ))}
          {opcionesPropias.length === 0 && opcionesGlobales.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
              Sin opciones todavía. Añade la primera abajo.
            </li>
          )}
        </ul>
      </Card>

      <Card className="flex gap-2">
        <input
          value={nuevoValor}
          onChange={(e) => setNuevoValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={
            categoria === "Metodos_Pago"
              ? "ej. PayPal, Cheque…"
              : "ej. Mudanza, Embarazo…"
          }
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={submittingNew || !nuevoValor.trim()}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {submittingNew ? "Añadiendo…" : "Añadir"}
        </button>
      </Card>
    </div>
  );
}

// ─── Fila de opción ────────────────────────────────────────────────────

function OpcionRow({
  opcion,
  isGlobalReference,
  onChanged,
}: {
  opcion: Opcion;
  isGlobalReference: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [valorEdit, setValorEdit] = useState(opcion.valor);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function patch(patchBody: Partial<{ valor: string; activo: boolean; orden: number }>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/configuraciones/opcion/${opcion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      onChanged();
    } catch {
      toast.error("No se pudo guardar el cambio. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    try {
      const res = await fetch(`/api/configuraciones/opcion/${opcion.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      setConfirmDelete(false);
      toast.success("Opción eliminada");
      onChanged();
    } catch {
      toast.error("No se pudo eliminar la opción. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-3 flex items-center gap-3">
      {editing ? (
        <>
          <input
            value={valorEdit}
            onChange={(e) => setValorEdit(e.target.value)}
            className="flex-1 px-2 py-1 text-sm border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={async () => {
              if (valorEdit.trim() && valorEdit !== opcion.valor) {
                await patch({ valor: valorEdit.trim() });
              }
              setEditing(false);
            }}
            disabled={busy}
            className="text-xs font-semibold text-[var(--color-accent)] hover:opacity-80 disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            onClick={() => {
              setValorEdit(opcion.valor);
              setEditing(false);
            }}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            Cancelar
          </button>
        </>
      ) : (
        <>
          <span
            className={`flex-1 text-sm ${
              opcion.activo ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)] line-through"
            }`}
          >
            {opcion.valor}
            {isGlobalReference && (
              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                default
              </span>
            )}
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={opcion.activo}
              disabled={busy || isGlobalReference}
              onChange={(e) => patch({ activo: e.target.checked })}
              title={isGlobalReference ? "No puedes desactivar un valor por defecto desde esta clínica; añade una opción propia." : "Activo"}
            />
            Activo
          </label>
          {!isGlobalReference && (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
              >
                Editar
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="text-xs text-[var(--color-danger)] hover:opacity-80 disabled:opacity-50"
              >
                Eliminar
              </button>
            </>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`¿Eliminar "${opcion.valor}"?`}
        description="Esta opción dejará de estar disponible para la clínica."
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onConfirm={destroy}
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  );
}

// ─── Plazos: single-value editor ───────────────────────────────────────

function PlazoSinglePanel({
  scope,
  opcionesPropias,
  opcionesGlobales,
  heredanGlobal,
  mostrandoGlobales,
  onChanged,
}: {
  scope: Scope;
  opcionesPropias: Opcion[];
  opcionesGlobales: Opcion[];
  heredanGlobal: boolean;
  mostrandoGlobales: boolean;
  onChanged: () => void;
}) {
  const efectivo = (opcionesPropias[0] ?? opcionesGlobales[0])?.valor ?? "90";
  const propio = opcionesPropias[0] ?? null;
  const [valor, setValor] = useState(efectivo);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValor(efectivo);
  }, [efectivo]);

  async function handleSave() {
    const num = Number(valor);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("El plazo debe ser un número mayor que 0 días.");
      return;
    }
    setBusy(true);
    try {
      if (propio) {
        const res = await fetch(`/api/configuraciones/opcion/${propio.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valor: String(num) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        // Crea override propio (o sobrescribe el global si scope=global).
        const res = await fetch(`/api/configuraciones/${scope}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoria: "Plazos_Liquidacion",
            valor: String(num),
            orden: 1,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      toast.success("Plazo guardado");
      onChanged();
    } catch {
      toast.error("No se pudo guardar el plazo. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="none" className="p-5 space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
            Plazo de liquidación (días)
          </label>
          <input
            type="number"
            min={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={busy || valor === efectivo}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
        Cuando un paciente acepta presupuesto y deja señal, este es el plazo estándar para
        esperar el pago de liquidación. Las alertas automáticas usan este valor.
        {heredanGlobal && !mostrandoGlobales && (
          <>
            {" "}
            Esta clínica está heredando el default global ({opcionesGlobales[0]?.valor ?? "90"} días).
            Al guardar un valor distinto se crea un override propio.
          </>
        )}
      </p>
    </Card>
  );
}

// ─── Plantillas WhatsApp panel — Sprint 14b Bloque 4 ───────────────────

type PlantillaCategoria = "cobranza" | "lead_seguimiento" | "cita_recordatorio";

type Plantilla = {
  id: string;
  nombre: string;
  categoria: PlantillaCategoria;
  contenido: string;
  variablesDetectadas: string[];
  clinicaId: string | null;
  activa: boolean;
};

const PLANTILLA_CATEGORIAS: Array<{ key: PlantillaCategoria; label: string }> = [
  { key: "cobranza", label: "Cobranza" },
  { key: "lead_seguimiento", label: "Seguimiento leads" },
  { key: "cita_recordatorio", label: "Recordatorios cita" },
];

function PlantillasPanel({ scope }: { scope: Scope }) {
  const [filtroCategoria, setFiltroCategoria] = useState<PlantillaCategoria>("cobranza");
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plantilla | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = true; // El layout /ajustes solo deja entrar a admin (Sprint 7).

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (scope !== "global") params.set("clinicaId", scope);
    params.set("categoria", filtroCategoria);
    params.set("all", "true");
    fetch(`/api/plantillas?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (cancelled) return;
        setPlantillas(j.plantillas ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error al cargar");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope, filtroCategoria, reloadKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
          Categoría
        </label>
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value as PlantillaCategoria)}
          className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          {PLANTILLA_CATEGORIAS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            + Añadir plantilla
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 dark:text-rose-300 dark:bg-rose-500/10 dark:border-rose-500/25 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-[var(--color-muted)] animate-pulse">Cargando…</p>
      ) : plantillas.length === 0 ? (
        <Card padding="none" className="p-8 text-center text-sm text-[var(--color-muted)]">
          No hay plantillas en esta categoría todavía.
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-border)]">
            {plantillas.map((p) => (
              <PlantillaRow
                key={p.id}
                plantilla={p}
                isGlobalReference={scope !== "global" && p.clinicaId === null}
                onEdit={() => setEditing(p)}
                onChanged={() => setReloadKey((k) => k + 1)}
              />
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <PlantillaEditor
          plantilla={editing}
          scope={scope}
          mode="edit"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {creating && (
        <PlantillaEditor
          mode="create"
          defaultCategoria={filtroCategoria}
          scope={scope}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function PlantillaRow({
  plantilla,
  isGlobalReference,
  onEdit,
  onChanged,
}: {
  plantilla: Plantilla;
  isGlobalReference: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function toggleActiva() {
    setBusy(true);
    try {
      const res = await fetch(`/api/plantillas/${plantilla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !plantilla.activa }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch {
      toast.error("No se pudo guardar el cambio. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-[var(--color-foreground)]">{plantilla.nombre}</p>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
              {plantilla.categoria}
            </span>
            {isGlobalReference && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                default
              </span>
            )}
            {!plantilla.activa && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                Inactiva
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-2 whitespace-pre-wrap">
            {plantilla.contenido}
          </p>
          {plantilla.variablesDetectadas.length > 0 && (
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              Variables: {plantilla.variablesDetectadas.join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={plantilla.activa}
              disabled={busy}
              onChange={toggleActiva}
            />
            Activa
          </label>
          <button
            onClick={onEdit}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-1.5 py-0.5 rounded hover:bg-[var(--color-surface-muted)]"
          >
            Editar
          </button>
        </div>
      </div>
    </li>
  );
}

function PlantillaEditor({
  mode,
  plantilla,
  scope,
  defaultCategoria,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  plantilla?: Plantilla;
  scope: Scope;
  defaultCategoria?: PlantillaCategoria;
  onClose: () => void;
  onDone: () => void;
}) {
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [categoria, setCategoria] = useState<PlantillaCategoria>(
    plantilla?.categoria ?? defaultCategoria ?? "cobranza",
  );
  const [contenido, setContenido] = useState(plantilla?.contenido ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [previewBusy, setPreviewBusy] = useState(false);

  // Preview en vivo (debounced 300ms).
  useEffect(() => {
    if (!contenido.trim()) {
      setPreview("");
      return;
    }
    setPreviewBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plantillas/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contenido }),
        });
        if (!res.ok) throw new Error();
        const j = await res.json();
        setPreview(String(j.texto ?? ""));
      } catch {
        setPreview("(no se pudo generar preview)");
      } finally {
        setPreviewBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [contenido]);

  async function handleSubmit() {
    if (!nombre.trim()) {
      setError("Nombre requerido");
      return;
    }
    if (!contenido.trim()) {
      setError("Contenido requerido");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "create") {
        const res = await fetch(`/api/plantillas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: nombre.trim(),
            categoria,
            contenido,
            clinicaId: scope === "global" ? null : scope,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
      } else {
        const res = await fetch(`/api/plantillas/${plantilla!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: nombre.trim(),
            categoria,
            contenido,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setSubmitting(false);
    }
  }

  const isGlobalReadOnly =
    mode === "edit" && plantilla?.clinicaId === null && scope !== "global";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            {mode === "create" ? "Nueva plantilla" : "Editar plantilla"}
          </h3>
          {isGlobalReadOnly && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 flex items-start gap-1.5">
              <AlertTriangle size={14} strokeWidth={ICON_STROKE} className="shrink-0 mt-px" aria-hidden />
              <span>
                Esta es una plantilla por defecto. Solo puedes editarla desde el ámbito
                &quot;Valores por defecto&quot;. Para personalizarla en esta clínica,
                crea una plantilla nueva con el mismo nombre.
              </span>
            </p>
          )}
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
                Nombre
              </label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                disabled={isGlobalReadOnly}
                placeholder="ej. recordatorio_senal"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
                Categoría
              </label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as PlantillaCategoria)}
                disabled={isGlobalReadOnly}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]"
              >
                {PLANTILLA_CATEGORIAS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
              Cuerpo del mensaje
            </label>
            <textarea
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              disabled={isGlobalReadOnly}
              rows={6}
              placeholder="Hola {{nombre}}, tu presupuesto de {{importe}}€..."
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-foreground)] font-mono focus:border-[var(--color-accent)] focus:outline-none resize-y disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-muted)]"
            />
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              Variables: {"{{nombre}} {{importe}} {{tratamiento}} {{nombre_doctor}} {{nombre_clinica}} {{fecha_aceptado}} {{plazo_dias}} {{dias_vencido}}"}
            </p>
          </div>
          <div>
            <label className="text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide">
              Preview con paciente real
            </label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] whitespace-pre-wrap min-h-[60px]">
              {previewBusy ? (
                <span className="text-[var(--color-muted)] italic">generando…</span>
              ) : preview ? (
                preview
              ) : (
                <span className="text-[var(--color-muted)] italic">
                  Escribe el cuerpo arriba para ver el preview con datos reales.
                </span>
              )}
            </div>
          </div>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 dark:text-rose-300 dark:bg-rose-500/10 dark:border-rose-500/25 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || isGlobalReadOnly}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {submitting ? "Guardando…" : mode === "create" ? "Crear plantilla" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
