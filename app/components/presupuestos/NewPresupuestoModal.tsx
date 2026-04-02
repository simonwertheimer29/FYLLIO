"use client";

import { useEffect, useState } from "react";
import type {
  Doctor, Presupuesto, PresupuestoEstado, UserSession,
  EspecialidadDoctor, TipoPaciente, TipoVisita, OrigenLead,
} from "../../lib/presupuestos/types";
import { ORIGEN_LABEL } from "../../lib/presupuestos/colors";

const ESPECIALIDADES: EspecialidadDoctor[] = [
  "General", "Prostodoncista", "Implantólogo", "Endodoncista", "Ortodoncia",
];

const ESTADOS_INICIALES: { value: PresupuestoEstado; label: string }[] = [
  { value: "PRESENTADO", label: "Presentado" },
  { value: "INTERESADO", label: "Interesado" },
  { value: "EN_DUDA", label: "En duda" },
  { value: "EN_NEGOCIACION", label: "En negociación" },
];

export default function NewPresupuestoModal({
  user,
  presupuesto,
  onClose,
  onCreated,
}: {
  user: UserSession;
  presupuesto?: Presupuesto;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!presupuesto;
  const [doctores, setDoctores] = useState<Doctor[]>([]);

  // Form fields
  const [patientName, setPatientName] = useState(presupuesto?.patientName ?? "");
  const [patientPhone, setPatientPhone] = useState(presupuesto?.patientPhone ?? "");
  const [treatments, setTreatments] = useState(presupuesto?.treatments.join(", ") ?? "");
  const [doctor, setDoctor] = useState(presupuesto?.doctor ?? "");
  const [doctorEspecialidad, setDoctorEspecialidad] = useState<EspecialidadDoctor>(
    presupuesto?.doctorEspecialidad ?? "General"
  );
  const [tipoPaciente, setTipoPaciente] = useState<TipoPaciente>(
    presupuesto?.tipoPaciente ?? "Privado"
  );
  const [tipoVisita, setTipoVisita] = useState<TipoVisita>(
    presupuesto?.tipoVisita ?? "Primera Visita"
  );
  const [amount, setAmount] = useState(presupuesto?.amount != null ? String(presupuesto.amount) : "");
  const [fechaPresupuesto, setFechaPresupuesto] = useState(
    presupuesto?.fechaPresupuesto ?? new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState(presupuesto?.notes ?? "");
  const [numeroHistoria, setNumeroHistoria] = useState(presupuesto?.numeroHistoria ?? "");
  const [origenLead, setOrigenLead] = useState<OrigenLead | "">(presupuesto?.origenLead ?? "");
  const [estadoInicial, setEstadoInicial] = useState<PresupuestoEstado>("PRESENTADO");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) {
      url.searchParams.set("clinica", user.clinica);
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setDoctores(d.doctores ?? []))
      .catch(() => {});
  }, [user]);

  function handleDoctorChange(nombre: string) {
    setDoctor(nombre);
    const found = doctores.find((d) => d.nombre === nombre);
    if (found) setDoctorEspecialidad(found.especialidad);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!patientName.trim()) { setError("El nombre del paciente es requerido"); return; }
    if (!treatments.trim()) { setError("Indica al menos un tratamiento"); return; }

    setSaving(true);
    try {
      const body = {
        patientName: patientName.trim(),
        patientPhone: patientPhone.trim() || undefined,
        treatments: treatments.split(",").map((t) => t.trim()).filter(Boolean),
        doctor: doctor || undefined,
        doctorEspecialidad: doctor ? doctorEspecialidad : undefined,
        tipoPaciente,
        tipoVisita,
        amount: amount ? Number(amount) : undefined,
        fechaPresupuesto,
        notes: notes.trim() || undefined,
        clinica: user.clinica,
        numeroHistoria: numeroHistoria.trim() || undefined,
        origenLead: origenLead || undefined,
        ...(!isEdit && { estadoInicial }),
      };

      const res = isEdit
        ? await fetch(`/api/presupuestos/kanban/${presupuesto!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/presupuestos/kanban", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Error al guardar");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg sm:rounded-3xl rounded-t-2xl bg-white shadow-2xl overflow-y-auto max-h-[95vh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">
            {isEdit ? "Editar presupuesto" : "Nuevo presupuesto"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Paciente */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nombre del paciente *
              </label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Nombre completo"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nº Historia</label>
              <input
                type="text"
                value={numeroHistoria}
                onChange={(e) => setNumeroHistoria(e.target.value)}
                placeholder="HCL-001"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Teléfono</label>
              <input
                type="tel"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                placeholder="+34 6XX XXX XXX"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Fecha presupuesto
              </label>
              <input
                type="date"
                value={fechaPresupuesto}
                onChange={(e) => setFechaPresupuesto(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            {!isEdit && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Estado inicial</label>
                <select
                  value={estadoInicial}
                  onChange={(e) => setEstadoInicial(e.target.value as PresupuestoEstado)}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {ESTADOS_INICIALES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Tratamientos */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Tratamiento(s) * <span className="text-slate-400 font-normal">(separar por coma)</span>
            </label>
            <input
              type="text"
              value={treatments}
              onChange={(e) => setTreatments(e.target.value)}
              placeholder="Implante dental, Corona cerámica"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          {/* Doctor + Importe */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Doctor</label>
              <select
                value={doctor}
                onChange={(e) => handleDoctorChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">Sin asignar</option>
                {doctores.map((d) => (
                  <option key={d.id} value={d.nombre}>{d.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Especialidad</label>
              <select
                value={doctorEspecialidad}
                onChange={(e) => setDoctorEspecialidad(e.target.value as EspecialidadDoctor)}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                {ESPECIALIDADES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo paciente</label>
              <select
                value={tipoPaciente}
                onChange={(e) => setTipoPaciente(e.target.value as TipoPaciente)}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="Privado">Privado</option>
                <option value="Adeslas">Adeslas</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo visita</label>
              <select
                value={tipoVisita}
                onChange={(e) => setTipoVisita(e.target.value as TipoVisita)}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="Primera Visita">1ª Visita</option>
                <option value="Paciente con Historia">Con Historia</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Importe (€)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min={0}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>

          {/* Notas + Origen */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones…"
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Origen del lead</label>
              <select
                value={origenLead}
                onChange={(e) => setOrigenLead(e.target.value as OrigenLead | "")}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">Sin especificar</option>
                {(Object.entries(ORIGEN_LABEL) as [OrigenLead, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold py-2.5 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-violet-600 text-white text-sm font-semibold py-2.5 hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear presupuesto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
