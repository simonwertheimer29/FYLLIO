"use client";

// G2.7 (dictado 31-08) — el editor de cita, REEMPLAZO ENTERO del modal.
//
// «El resultado tiene que sentirse como poner una cita en un calendario, no
// como rellenar un alta»: panel FLOTANTE sin oscurecer — el bloque borrador
// sigue visible (y arrastrable, y estirable) en la rejilla mientras
// rellenas. Fecha, hora y doctor NO son campos: ya los elegiste con el
// ratón; son una línea de texto («Lun 31 ago · 10:30–11:00 · Dr. Molina»)
// con un «cambiar» discreto por si acaso. Lo único en primer plano es lo
// que falta de verdad: el PACIENTE y el TIPO DE CITA — y al elegir tipo, el
// bloque de la rejilla crece o encoge a la vista (la duración del catálogo).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cargarJSON } from "../../lib/fetch-json";
import { deMin } from "../../lib/agenda/disponibilidad";
import { fechaCorta } from "../../lib/agenda/fechas";
import { X, Pencil, ICON_STROKE } from "../../components/icons";

export type BorradorCita = {
  modo: "crear" | "editar";
  citaId?: string;
  nombre: string;
  pacienteId: string | null;
  tipoCitaId: string;
  fecha: string;
  staffId: string;
  inicioMin: number;
  duracionMin: number;
};

const INPUT =
  "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

export function EditorCitaFlotante({
  borrador,
  doctores,
  tratamientos,
  onCambia,
  onClose,
  onGuardada,
}: {
  borrador: BorradorCita;
  doctores: Array<{ id: string; nombre: string; clinicaId: string | null }>;
  tratamientos: Array<{ id: string; nombre: string; duracionMin: number | null; clinicaId: string | null }>;
  /** Todo cambio pasa por aquí: el bloque de la rejilla ES el borrador. */
  onCambia: (patch: Partial<BorradorCita>) => void;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [editandoCuando, setEditandoCuando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda de paciente (crear): elegir vincula la ficha; texto libre crea
  // sin ficha (sin recordatorios) y se dice antes de guardar.
  const [sugerencias, setSugerencias] = useState<Array<{ id: string; nombre: string }>>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (borrador.modo !== "crear") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = borrador.nombre.trim();
    if (q.length < 3 || borrador.pacienteId) { setSugerencias([]); return; }
    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const d = await cargarJSON<{ pacientes: Array<{ id: string; nombre: string }> }>(
            `/api/pacientes?search=${encodeURIComponent(q)}`,
          );
          setSugerencias(d.pacientes.slice(0, 5).map((p) => ({ id: p.id, nombre: p.nombre })));
        } catch {
          // caída-declarada: sin sugerencias se crea igual con nombre libre — la búsqueda es ayuda, no requisito
          setSugerencias([]);
        }
      })();
    }, 450);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [borrador.nombre, borrador.pacienteId, borrador.modo]);

  // G2.8 — el panel se coloca JUNTO al bloque borrador, nunca encima: a su
  // derecha si hay sitio, a su izquierda si el bloque está pegado al borde
  // derecho. Se recoloca cuando el borrador cambia (arrastres incluidos).
  const ANCHO = 320;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const coloca = () => {
      const bloque = document.querySelector("[data-borrador]");
      if (!bloque) { setPos(null); return; }
      const r = bloque.getBoundingClientRect();
      const margen = 16;
      let left = r.right + margen;
      if (left + ANCHO > window.innerWidth - 8) left = r.left - ANCHO - margen;
      if (left < 8) left = Math.min(window.innerWidth - ANCHO - 8, Math.max(8, r.right + margen));
      const top = Math.max(72, Math.min(r.top, window.innerHeight - 380));
      setPos({ left, top });
    };
    coloca();
    window.addEventListener("resize", coloca);
    window.addEventListener("scroll", coloca, true);
    return () => {
      window.removeEventListener("resize", coloca);
      window.removeEventListener("scroll", coloca, true);
    };
  }, [borrador.fecha, borrador.staffId, borrador.inicioMin, borrador.duracionMin]);

  const doctor = doctores.find((d) => d.id === borrador.staffId) ?? null;
  const finMin = borrador.inicioMin + borrador.duracionMin;
  const puedeGuardar = Boolean(borrador.nombre.trim()) && Boolean(borrador.staffId) && !saving;

  async function guardar() {
    if (!puedeGuardar) return;
    setSaving(true);
    setError(null);
    const cuerpo = {
      fecha: borrador.fecha,
      hora: deMin(borrador.inicioMin),
      doctorId: borrador.staffId,
      tratamientoId: borrador.tipoCitaId || null,
      duracionMin: borrador.duracionMin,
    };
    try {
      if (borrador.modo === "crear") {
        await cargarJSON("/api/agenda/citas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cuerpo, nombre: borrador.nombre.trim(), pacienteId: borrador.pacienteId }),
        });
        toast.success("Cita creada. Recuerda pasarla también a tu software.");
      } else {
        await cargarJSON(`/api/agenda/citas/${borrador.citaId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        });
        toast.success("Cita movida. Recuerda cambiarla también en tu software.");
      }
      onGuardada();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-editor-cita
      className="fixed z-50 w-80 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xl"
      style={pos ? { left: pos.left, top: pos.top } : { right: 24, top: 112 }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[var(--color-foreground)]">
          {borrador.modo === "crear" ? "Nueva cita" : "Mover cita"}
        </h3>
        <button type="button" onClick={onClose} aria-label="Cerrar sin guardar"
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
          <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </div>

      {/* Lo YA elegido con el ratón: una línea, no un formulario. */}
      <div className="mb-3 flex items-start justify-between gap-2 rounded-xl bg-[var(--color-surface-muted)] px-3 py-2">
        <p className="text-[12px] font-medium text-[var(--color-foreground)] [font-variant-numeric:tabular-nums]">
          {fechaCorta(borrador.fecha)} · {deMin(borrador.inicioMin)}–{deMin(finMin)}
          <span className="block text-[11px] font-normal text-[var(--color-muted)]">{doctor?.nombre ?? "—"}</span>
        </p>
        <button
          type="button"
          onClick={() => setEditandoCuando((v) => !v)}
          aria-label="Cambiar fecha, hora o doctor"
          className="mt-0.5 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          <Pencil size={13} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </div>
      {editandoCuando && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <input type="date" value={borrador.fecha} onChange={(e) => e.target.value && onCambia({ fecha: e.target.value })} className={INPUT} />
          <input
            type="time"
            value={deMin(borrador.inicioMin)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isFinite(h)) onCambia({ inicioMin: h * 60 + (m || 0) });
            }}
            className={INPUT}
          />
          <select value={borrador.staffId} onChange={(e) => onCambia({ staffId: e.target.value })} className={`${INPUT} col-span-2`}>
            {doctores.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
      )}

      {/* Lo que FALTA de verdad, en primer plano. */}
      {borrador.modo === "crear" && (
        <div className="mb-3">
          <input
            autoFocus
            value={borrador.nombre}
            onChange={(e) => onCambia({ nombre: e.target.value, pacienteId: null })}
            placeholder="Paciente"
            className={`${INPUT} text-[15px] font-medium`}
          />
          {sugerencias.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-xl border border-[var(--color-border)]">
              {sugerencias.map((p) => (
                <button key={p.id} type="button"
                  onClick={() => { onCambia({ nombre: p.nombre, pacienteId: p.id }); setSugerencias([]); }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]">
                  {p.nombre}
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-[10px] text-[var(--color-muted)]">
            {borrador.pacienteId ? "Vinculada a su ficha — recibirá recordatorios." : "Elige de la búsqueda para vincular la ficha; sin ella no hay recordatorios."}
          </p>
        </div>
      )}

      <select
        value={borrador.tipoCitaId}
        onChange={(e) => {
          const t = tratamientos.find((x) => x.id === e.target.value);
          // El bloque de la rejilla crece o encoge A LA VISTA con el tipo.
          onCambia({
            tipoCitaId: e.target.value,
            ...(t?.duracionMin ? { duracionMin: t.duracionMin } : {}),
          });
        }}
        className={INPUT}
      >
        <option value="">Tipo de cita…</option>
        {tratamientos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}{t.duracionMin != null ? ` · ${t.duracionMin} min` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[10px] text-[var(--color-muted)]">
        El bloque de la rejilla es el borrador: arrástralo para moverlo o estira sus bordes para cambiar la duración.
      </p>

      {error && (
        <p className="mt-2 rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onClose}
          className="flex-1 rounded-xl bg-[var(--color-surface-muted)] py-2 text-sm font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-border)]">
          Cancelar
        </button>
        <button type="button" onClick={() => void guardar()} disabled={!puedeGuardar}
          className="flex-1 rounded-xl bg-[var(--color-accent)] py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
