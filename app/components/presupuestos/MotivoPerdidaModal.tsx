"use client";

import { useState } from "react";
import type { MotivoPerdida } from "../../lib/presupuestos/types";

const MOTIVOS: { valor: MotivoPerdida; label: string }[] = [
  { valor: "precio_alto",           label: "Precio alto" },
  { valor: "otra_clinica",          label: "Eligió otra clínica" },
  { valor: "sin_urgencia",          label: "Sin urgencia percibida" },
  { valor: "necesita_financiacion", label: "Necesita financiación" },
  { valor: "miedo_tratamiento",     label: "Miedo al tratamiento" },
  { valor: "no_responde",           label: "No responde tras múltiples intentos" },
  { valor: "otro",                  label: "Otro (especificar)" },
];

export default function MotivoPerdidaModal({
  patientName,
  onConfirm,
  onCancel,
}: {
  patientName: string;
  onConfirm: (motivo: MotivoPerdida, texto?: string) => void;
  onCancel: () => void;
}) {
  const [seleccionado, setSeleccionado] = useState<MotivoPerdida | null>(null);
  const [texto, setTexto] = useState("");

  function handleConfirm() {
    if (!seleccionado) return;
    onConfirm(seleccionado, seleccionado === "otro" ? texto.trim() || undefined : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="text-sm font-bold text-slate-900 mb-1">
          ¿Por qué se perdió este presupuesto?
        </p>
        <p className="text-xs text-slate-500 mb-4">
          <span className="font-semibold">{patientName}</span> — se moverá a{" "}
          <span className="font-bold text-rose-600">Perdido</span>
        </p>

        <div className="space-y-2 mb-4">
          {MOTIVOS.map((m) => (
            <label
              key={m.valor}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                seleccionado === m.valor
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="motivo"
                value={m.valor}
                checked={seleccionado === m.valor}
                onChange={() => setSeleccionado(m.valor)}
                className="accent-rose-600"
              />
              <span className="text-xs font-medium text-slate-700">{m.label}</span>
            </label>
          ))}
        </div>

        {seleccionado === "otro" && (
          <textarea
            placeholder="Describe el motivo…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-rose-300 mb-4"
          />
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold py-2 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!seleccionado}
            className="flex-1 rounded-xl bg-rose-600 text-white text-sm font-semibold py-2 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirmar y mover
          </button>
        </div>
      </div>
    </div>
  );
}
