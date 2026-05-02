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

type Scope = "global" | string; // "global" o clinicaId

type Categoria =
  | "Metodos_Pago"
  | "Plazos_Liquidacion"
  | "Razones_No_Interesado"
  | "Plantillas_Scope";

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
    help: "Scope de plantillas (Bloque 4 cierra la edición desde aquí).",
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
  // los defaults aunque la clínica ya haya customizado.
  useEffect(() => {
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
        <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
        <p className="text-sm text-slate-500 mt-1">
          Adapta Fyllio al workflow de cada clínica. Los defaults globales son la referencia
          inicial; cuando una clínica añade su propia opción, sustituye los globales en
          esa categoría para esa clínica.
        </p>
      </div>

      {/* Scope selector */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
        <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
          Scope
        </label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
        >
          <option value="global">🌐 Defaults globales</option>
          {clinicas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {!mostrandoGlobales && (
          <span className="text-[11px] text-slate-400">
            {heredanGlobal
              ? "Esta clínica hereda los defaults globales en esta categoría."
              : `${opcionesPropias.length} opciones propias.`}
          </span>
        )}
      </div>

      {/* Tabs categoría */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setCategoria(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              categoria === t.key
                ? "text-slate-900 border-slate-900"
                : "text-slate-500 border-transparent hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">{tab.help}</p>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 animate-pulse">Cargando opciones…</p>
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
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al añadir");
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
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        La gestión de plantillas WhatsApp se cierra en el Bloque 4 del Sprint 14b
        (recordatorios de cobro). Por ahora, edita las plantillas legacy desde la
        tabla <code className="text-[11px]">Plantillas_Mensaje</code> de Airtable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            {mostrandoGlobales
              ? "Opciones globales"
              : heredanGlobal
              ? "Heredando defaults globales"
              : "Opciones de esta clínica"}
          </p>
          <p className="text-[11px] text-slate-400">
            {opcionesPropias.length === 0 && !mostrandoGlobales
              ? `${opcionesGlobales.length} default${opcionesGlobales.length === 1 ? "" : "s"} global${opcionesGlobales.length === 1 ? "" : "es"}`
              : `${opcionesPropias.length} opcion${opcionesPropias.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <ul className="divide-y divide-slate-50">
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
            <li className="px-4 py-6 text-center text-sm text-slate-400">
              Sin opciones todavía. Añade la primera abajo.
            </li>
          )}
        </ul>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-2">
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
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={submittingNew || !nuevoValor.trim()}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {submittingNew ? "Añadiendo…" : "Añadir"}
        </button>
      </div>
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

  async function patch(patchBody: Partial<{ valor: string; activo: boolean; orden: number }>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/configuraciones/${opcion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
      }
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!confirm(`¿Eliminar "${opcion.valor}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/configuraciones/${opcion.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al eliminar");
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
            className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded"
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
            className="text-xs font-semibold text-slate-700 hover:text-slate-900"
          >
            Guardar
          </button>
          <button
            onClick={() => {
              setValorEdit(opcion.valor);
              setEditing(false);
            }}
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            Cancelar
          </button>
        </>
      ) : (
        <>
          <span
            className={`flex-1 text-sm ${
              opcion.activo ? "text-slate-800" : "text-slate-400 line-through"
            }`}
          >
            {opcion.valor}
            {isGlobalReference && (
              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                default
              </span>
            )}
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={opcion.activo}
              disabled={busy || isGlobalReference}
              onChange={(e) => patch({ activo: e.target.checked })}
              title={isGlobalReference ? "No puedes desactivar un default global desde esta clínica; añade el override propio." : "Activo"}
            />
            Activo
          </label>
          {!isGlobalReference && (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                Editar
              </button>
              <button
                onClick={destroy}
                disabled={busy}
                className="text-xs text-rose-500 hover:text-rose-700 disabled:opacity-50"
              >
                Eliminar
              </button>
            </>
          )}
        </>
      )}
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
      alert("Plazo debe ser un número > 0 días.");
      return;
    }
    setBusy(true);
    try {
      if (propio) {
        const res = await fetch(`/api/configuraciones/${propio.id}`, {
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
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">
            Plazo de liquidación (días)
          </label>
          <input
            type="number"
            min={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={busy || valor === efectivo}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
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
    </div>
  );
}
