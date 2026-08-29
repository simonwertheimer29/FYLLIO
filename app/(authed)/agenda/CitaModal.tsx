"use client";

// G2.4 — crear y MOVER citas desde la rejilla. Mismo patrón de modal de la
// casa (overlay + card, como PagoModal) y los CamposCita compartidos con el
// AgendarModal de leads.
//
// Crear: paciente por búsqueda (vinculado a su ficha) o nombre libre — sin
// ficha no hay recordatorios y se dice aquí, antes de guardar. Mover: solo
// citas nacidas en Fyllio (la regla vive en la API; aquí ni se ofrece para
// las importadas) — el nombre no se toca, se toca el cuándo y el quién.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cargarJSON } from "../../lib/fetch-json";
import { X, ICON_STROKE } from "../../components/icons";
import { CamposCita, Labeled, type DoctorOpcion, type TratamientoOpcion } from "../../components/agenda/CamposCita";

export type CitaEnEdicion = {
  id: string;
  nombre: string | null;
  fecha: string;
  hora: string; // "HH:MM"
  doctorId: string;
  tratamientoId: string | null;
};

export function CitaModal({
  modo,
  inicial,
  doctores,
  tratamientos,
  onClose,
  onSaved,
}: {
  modo: "crear" | "mover";
  /** crear: {fecha} prefijada · mover: la cita entera. */
  inicial: Partial<CitaEnEdicion> & { fecha: string };
  doctores: DoctorOpcion[];
  tratamientos: TratamientoOpcion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(inicial.nombre ?? "");
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [hora, setHora] = useState(inicial.hora ?? "");
  const [doctorId, setDoctorId] = useState(inicial.doctorId ?? "");
  const [tipoCitaId, setTipoCitaId] = useState(inicial.tratamientoId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda de paciente (crear): debounced, ≥3 letras. Elegir de la lista
  // vincula la ficha; texto libre = cita sin ficha (sin recordatorios).
  const [sugerencias, setSugerencias] = useState<Array<{ id: string; nombre: string }>>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (modo !== "crear") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = nombre.trim();
    if (q.length < 3 || pacienteId) { setSugerencias([]); return; }
    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const d = await cargarJSON<{ pacientes: Array<{ id: string; nombre: string }> }>(
            `/api/pacientes?search=${encodeURIComponent(q)}`,
          );
          setSugerencias(d.pacientes.slice(0, 6).map((p) => ({ id: p.id, nombre: p.nombre })));
        } catch {
          // caída-declarada: sin sugerencias se puede crear igual con nombre libre — la búsqueda es ayuda, no requisito
          setSugerencias([]);
        }
      })();
    }, 500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [nombre, pacienteId, modo]);

  const canSave = Boolean(nombre.trim()) && Boolean(fecha) && /^\d{1,2}:\d{2}$/.test(hora) && Boolean(doctorId) && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (modo === "crear") {
        await cargarJSON("/api/agenda/citas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: nombre.trim(), pacienteId, fecha, hora, doctorId,
            tratamientoId: tipoCitaId || null,
          }),
        });
      } else {
        await cargarJSON(`/api/agenda/citas/${inicial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fecha, hora, doctorId, tratamientoId: tipoCitaId || null }),
        });
      }
      // El aviso dictado (nivel 1): el traspaso al software es manual SIEMPRE.
      toast.success(
        modo === "crear"
          ? "Cita creada. Recuerda pasarla también a tu software."
          : "Cita movida. Recuerda cambiarla también en tu software.",
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              {modo === "crear" ? "Nueva cita" : "Mover cita"}
            </h3>
            {modo === "mover" && (
              <p className="truncate text-[11px] text-[var(--color-muted)]">{inicial.nombre ?? "—"}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar sin guardar"
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {modo === "crear" && (
          <Labeled label="Paciente" required>
            <input
              value={nombre}
              onChange={(e) => { setNombre(e.target.value); setPacienteId(null); }}
              placeholder="Busca por nombre o escríbelo"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            {sugerencias.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-xl border border-[var(--color-border)]">
                {sugerencias.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setNombre(p.nombre); setPacienteId(p.id); setSugerencias([]); }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]"
                  >
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] text-[var(--color-muted)]">
              {pacienteId
                ? "Vinculada a su ficha — recibirá recordatorios."
                : "Sin ficha vinculada, la cita no recibe recordatorios. Elige un paciente de la búsqueda para vincularla."}
            </p>
          </Labeled>
        )}

        <CamposCita
          fecha={fecha}
          setFecha={setFecha}
          hora={hora}
          setHora={setHora}
          doctorId={doctorId}
          setDoctorId={setDoctorId}
          tipoCitaId={tipoCitaId}
          setTipoCitaId={setTipoCitaId}
          doctores={doctores}
          tratamientos={tratamientos}
        />

        {error && (
          <p className="rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl bg-[var(--color-surface-muted)] py-2.5 text-sm font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-border)]">
            Cancelar
          </button>
          <button type="submit" disabled={!canSave}
            className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Guardando…" : modo === "crear" ? "Crear cita" : "Mover cita"}
          </button>
        </div>
      </form>
    </div>
  );
}
