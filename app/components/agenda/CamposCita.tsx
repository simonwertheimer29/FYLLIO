"use client";

// G2.4 — los campos comunes de una cita (fecha, hora, doctor, tipo de cita
// del catálogo). Los comparten el AgendarModal de leads y el CitaModal de la
// rejilla: una sola implementación de la regla que importa — el TIPO DE CITA
// define la duración, y sin él la agenda no puede afirmar huecos ese día (y
// se dice aquí, no se descubre después).

export type DoctorOpcion = { id: string; nombre: string; clinicaId: string | null };
export type TratamientoOpcion = { id: string; nombre: string; duracionMin: number | null; clinicaId: string | null };

export function Labeled({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--color-muted)]">
        {label}
        {required && <span className="text-[var(--color-danger)]"> *</span>}
      </span>
      {children}
    </label>
  );
}

const INPUT =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

export function CamposCita({
  fecha,
  setFecha,
  hora,
  setHora,
  doctorId,
  setDoctorId,
  tipoCitaId,
  setTipoCitaId,
  doctores,
  tratamientos,
  clinicaId,
}: {
  fecha: string;
  setFecha: (v: string) => void;
  hora: string;
  setHora: (v: string) => void;
  doctorId: string;
  setDoctorId: (v: string) => void;
  tipoCitaId: string;
  setTipoCitaId: (v: string) => void;
  doctores: DoctorOpcion[];
  tratamientos: TratamientoOpcion[];
  /** Con clínica conocida, doctores y catálogo se acotan a ella. */
  clinicaId?: string | null;
}) {
  const doctoresVisibles = clinicaId ? doctores.filter((d) => d.clinicaId === clinicaId) : doctores;
  const catalogo = (() => {
    if (!clinicaId) return tratamientos;
    const propios = tratamientos.filter((t) => !t.clinicaId || t.clinicaId === clinicaId);
    return propios.length ? propios : tratamientos;
  })();

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Fecha" required>
          <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={INPUT} />
        </Labeled>
        <Labeled label="Hora" required>
          <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className={INPUT} />
        </Labeled>
      </div>

      <Labeled label="Doctor" required>
        <select required value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={INPUT}>
          <option value="">— Selecciona —</option>
          {doctoresVisibles.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre}</option>
          ))}
        </select>
        {doctoresVisibles.length === 0 && (
          <p className="mt-1 text-[10px] text-[var(--color-warning)]">
            La clínica no tiene dentistas cargados. Añade uno desde Ajustes.
          </p>
        )}
      </Labeled>

      <Labeled label="Tipo de cita en agenda (define la duración)">
        <select value={tipoCitaId} onChange={(e) => setTipoCitaId(e.target.value)} className={INPUT}>
          <option value="">— Sin duración definida —</option>
          {catalogo.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
              {t.duracionMin != null ? ` · ${t.duracionMin} min` : " · sin duración configurada"}
            </option>
          ))}
        </select>
        {!tipoCitaId && (
          <p className="mt-1 text-[10px] text-[var(--color-warning)]">
            Sin tipo de cita, la agenda no podrá afirmar huecos libres ese día.
          </p>
        )}
      </Labeled>
    </>
  );
}
