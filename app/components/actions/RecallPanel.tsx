"use client";

import { useEffect, useState } from "react";

type Patient = {
  name: string;
  phone: string;
  lastVisit: string;
  lastVisitDisplay: string;
  lastTreatment: string;
  daysSinceVisit: number;
};

function whatsappLink(phone: string, name: string, lastTreatment: string) {
  const msg = encodeURIComponent(
    `Hola ${name} 🙂 Desde la clínica queríamos saber cómo estás después de tu última visita` +
      (lastTreatment ? ` de ${lastTreatment}` : "") +
      `. ¿Te gustaría programar una revisión? Escríbenos y te buscamos una franja disponible 🦷`
  );
  const clean = phone.replace(/\s+/g, "");
  return `https://wa.me/${clean.replace("+", "")}?text=${msg}`;
}

export default function RecallPanel() {
  const [months, setMonths] = useState(6);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(m: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/recall?months=${m}`, { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPatients(json.patients ?? []);
    } catch (e: any) {
      setError(e.message ?? "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(months);
  }, []);

  function handleMonthsChange(m: number) {
    setMonths(m);
    load(m);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Recall de pacientes</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Pacientes sin visita en los últimos {months} meses
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-semibold">Sin visita en:</label>
          <select
            value={months}
            onChange={(e) => handleMonthsChange(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-xl px-2 py-1.5 bg-white focus:outline-none"
          >
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={18}>18 meses</option>
          </select>

          <button
            type="button"
            onClick={() => load(months)}
            className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
          >
            Refrescar
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando pacientes...</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : patients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">No hay pacientes pendientes de recall 🎉</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            <b>{patients.length}</b> pacientes sin cita reciente
          </p>
          <div className="space-y-2">
            {patients.map((p, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Última visita: <b>{p.lastVisitDisplay}</b>
                    {p.lastTreatment && ` · ${p.lastTreatment}`}
                  </p>
                  <p className="text-xs text-slate-400">{p.daysSinceVisit} días sin visita</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {p.phone ? (
                    <a
                      href={whatsappLink(p.phone, p.name, p.lastTreatment)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-semibold"
                    >
                      💬 WhatsApp
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Sin teléfono</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
