"use client";

import { useMemo, useState } from "react";
import type { RulesState, TreatmentScheduleRule, AllowedWindow } from "../../lib/types";
import type { RulesValidation } from "../../lib/rules/validateRules";
import AiPrimaryButton from "../ui/AiPrimaryButton";


type Props = {
  rules: RulesState;
  onChange: (next: RulesState) => void;
  onReset?: () => void;
  onSimulate?: () => void;
  busy?: boolean;
  validation?: RulesValidation;
};

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeHHMM(v: string) {
  return (v ?? "").trim();
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{props.label}</span>
      {props.hint ? <p className="mt-1 text-[11px] text-slate-500">{props.hint}</p> : null}
      <input
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{props.label}</span>
      {props.hint ? <p className="mt-1 text-[11px] text-slate-500">{props.hint}</p> : null}
      <input
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function Switch(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{props.label}</p>
        {props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => props.onChange(!props.checked)}
        className={
          props.checked
            ? "text-xs px-3 py-1 rounded-full bg-sky-600 text-white hover:bg-sky-700"
            : "text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200"
        }
      >
        {props.checked ? "ON" : "OFF"}
      </button>
    </div>
  );
}

/** Librería de tratamientos */
const TREATMENT_LIBRARY: Array<{ type: string; defaultDurationMin: number }> = [
  { type: "Revisión", defaultDurationMin: 25 },
  { type: "Limpieza", defaultDurationMin: 35 },
  { type: "Empaste", defaultDurationMin: 45 },
  { type: "Ortodoncia", defaultDurationMin: 30 },
  { type: "Endodoncia", defaultDurationMin: 65 },
  { type: "Urgencia", defaultDurationMin: 30 },
  { type: "Extracción", defaultDurationMin: 45 },
  { type: "Implante", defaultDurationMin: 60 },
];

export default function RulesForm({ rules, onChange, onReset, onSimulate, busy, validation }: Props) {
  const set = (patch: Partial<RulesState>) => {
    onChange({ ...rules, ...patch });
  };

  const treatments = rules.treatments ?? [];
  const [selectedType, setSelectedType] = useState<string>("");

  const addFromSelect = (type: string) => {
    const clean = (type ?? "").trim();
    if (!clean) return;

    const exists = treatments.some((t) => (t.type ?? "").trim().toLowerCase() === clean.toLowerCase());
    if (exists) return;

    const def = TREATMENT_LIBRARY.find((x) => x.type === clean);

    const next: TreatmentScheduleRule[] = [
      ...treatments,
      {
        type: clean,
        durationMin: def?.defaultDurationMin ?? 30,
        bufferMin: 0,
      },
    ];

    set({ treatments: next });
  };

  const updateTreatment = (idx: number, patch: Partial<TreatmentScheduleRule>) => {
    const next = treatments.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    set({ treatments: next });
  };

  const removeTreatment = (idx: number) => {
    const next = treatments.filter((_, i) => i !== idx);
    set({ treatments: next });
  };

  const availableToAdd = useMemo(
    () =>
      TREATMENT_LIBRARY.filter((opt) => !treatments.some((t) => (t.type ?? "").trim().toLowerCase() === opt.type.toLowerCase())),
    [treatments]
  );

  return (
    <section className="rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900">Reglas</h2>
          <p className="mt-2 text-sm text-slate-600">
            Fyllio seguirá estas reglas <b>siempre</b>. La IA crea una agenda respetándolas.
          </p>

          {validation ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={
                  validation.ready
                    ? "text-[11px] px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold"
                    : "text-[11px] px-3 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-900 font-semibold"
                }
              >
                {validation.ready ? "✅ Reglas listas" : "⚠️ Falta ajustar reglas"}
              </span>

              {!validation.ready ? (
                <span className="text-[11px] text-slate-600">{validation.errors[0]}</span>
              ) : validation.warnings.length ? (
                <span className="text-[11px] text-slate-600">{validation.warnings[0]}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {onReset ? (
            <button type="button" onClick={onReset} className="text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200">
              Reset
            </button>
          ) : null}

          {onSimulate ? (
           <AiPrimaryButton
  onClick={onSimulate}
  disabled={busy || !validation?.ready}
  recommended
>
  {busy ? "Simulando..." : "Simular con IA"}
</AiPrimaryButton>


          ) : null}
        </div>
      </div>

      {/* ✅ Horario (limpio) */}
      <div className="mt-6 rounded-3xl bg-slate-50/70 p-5 border border-slate-100">
        <p className="text-sm font-bold text-slate-900">Horario</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextField label="Inicio (HH:MM)" value={rules.dayStartTime} placeholder="08:30" onChange={(v) => set({ dayStartTime: v })} />
          <TextField label="Fin (HH:MM)" value={rules.dayEndTime} placeholder="19:00" onChange={(v) => set({ dayEndTime: v })} />
        </div>

        <div className="mt-6 rounded-3xl bg-slate-50/70 p-5 border border-slate-100">
  <p className="text-sm font-bold text-slate-900">Buffers</p>

  <div className="mt-4 grid gap-3 md:grid-cols-2">
    <Switch
      label="Buffers activos"
      checked={!!rules.enableBuffers}
      onChange={(v) => set({ enableBuffers: v })}
      hint="Si OFF, nunca se generan buffers."
    />

    <NumberField
      label="Buffer global (min)"
      value={Number.isFinite(rules.bufferMin as any) ? Number(rules.bufferMin) : 0}
      min={0}
      step={5}
      onChange={(v) => set({ bufferMin: clampInt(v, 0, 60) })}
      hint="Se usa si el tratamiento no define buffer. 0 = sin buffer."
    />
  </div>
</div>


        {/* Switches juntos, debajo */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Switch label="Trabaja los sábados" checked={rules.workSat} onChange={(v) => set({ workSat: v })} hint="Si OFF, sábado queda vacío." />

          <Switch
            label="Almuerzo activo"
            checked={!!rules.enableLunch}
            onChange={(v) => set({ enableLunch: v })}
            hint="Si ON, no se agenda dentro del almuerzo."
          />
        </div>

        {/* Horas de almuerzo SOLO si enableLunch */}
        {!!rules.enableLunch ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TextField
              label="Almuerzo inicio (HH:MM)"
              value={rules.lunchStartTime ?? ""}
              placeholder="13:30"
              onChange={(v) => set({ lunchStartTime: v })}
            />
            <TextField
              label="Almuerzo fin (HH:MM)"
              value={rules.lunchEndTime ?? ""}
              placeholder="14:30"
              onChange={(v) => set({ lunchEndTime: v })}
            />
          </div>
        ) : null}

        {/* NOTA: minBookableSlotMin y chairsCount siguen existiendo en rules, pero no se muestran */}
      </div>

      {/* ✅ Tratamientos */}
      <div className="mt-6 rounded-3xl bg-slate-50/70 p-5 border border-slate-100">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-bold text-slate-900">Tratamientos</p>
            <p className="mt-1 text-xs text-slate-600">Elige desde la lista y se agrega. Puedes definir duración, buffer y ventanas.</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Seleccionar tratamiento</span>
              <select
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
                value={selectedType}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  addFromSelect(v);
                  setSelectedType("");
                }}
              >
                <option value="">— Elegir —</option>
                {availableToAdd.map((opt) => (
                  <option key={opt.type} value={opt.type}>
                    {opt.type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {treatments.length ? (
          <div className="mt-4 grid gap-3">
            {treatments.map((t, idx) => (
              <div key={`${t.type}_${idx}`} className="rounded-3xl bg-white border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-slate-900">{(t.type ?? "").trim() || "Tratamiento"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Esto alimenta a la IA: <b>type + durationMin</b> (+ buffer/ventanas opcional).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeTreatment(idx)}
                    className="text-xs px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-800 font-semibold hover:bg-rose-100"
                  >
                    Eliminar
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <TextField label="Nombre" value={t.type ?? ""} onChange={(v) => updateTreatment(idx, { type: v })} />

                  <NumberField
                    label="Duración (min)"
                    value={Number.isFinite(t.durationMin) ? t.durationMin : 30}
                    min={10}
                    step={5}
                    onChange={(v) => updateTreatment(idx, { durationMin: clampInt(v, 10, 240) })}
                  />

                  <NumberField
                    label="Buffer previo (min)"
                    value={Number.isFinite(t.bufferMin as any) ? Number(t.bufferMin) : 0}
                    min={0}
                    step={5}
                    onChange={(v) => updateTreatment(idx, { bufferMin: clampInt(v, 0, 60) })}
                    hint="Tiempo antes del tratamiento."
                  />
                </div>

                {/* Ventanas permitidas */}
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-extrabold text-slate-900">Ventanas permitidas</p>

                    <button
                      type="button"
                      onClick={() => {
                        const cur = (t.allowedWindows ?? []).slice();
                        cur.push({ startHHMM: "09:00", endHHMM: "13:00" });
                        updateTreatment(idx, { allowedWindows: cur });
                      }}
                      className="text-xs px-3 py-1 rounded-full bg-white border border-slate-200 font-semibold hover:bg-slate-100"
                    >
                      + Añadir
                    </button>
                  </div>

                  <p className="mt-1 text-[11px] text-slate-600">Si defines ventanas, este tratamiento SOLO se agenda dentro de esas franjas.</p>

                  {(t.allowedWindows ?? []).length ? (
                    <div className="mt-3 grid gap-2">
                      {(t.allowedWindows ?? []).map((w: AllowedWindow, wi: number) => (
                        <div key={wi} className="flex items-center gap-2 flex-wrap">
                          <TextField
                            label="Inicio"
                            value={w.startHHMM ?? ""}
                            placeholder="09:00"
                            onChange={(v) => {
                              const next = (t.allowedWindows ?? []).slice();
                              next[wi] = { ...next[wi], startHHMM: normalizeHHMM(v) };
                              updateTreatment(idx, { allowedWindows: next });
                            }}
                          />

                          <TextField
                            label="Fin"
                            value={w.endHHMM ?? ""}
                            placeholder="13:00"
                            onChange={(v) => {
                              const next = (t.allowedWindows ?? []).slice();
                              next[wi] = { ...next[wi], endHHMM: normalizeHHMM(v) };
                              updateTreatment(idx, { allowedWindows: next });
                            }}
                          />

                          <button
                            type="button"
                            onClick={() => {
                              const next = (t.allowedWindows ?? []).filter((_, j) => j !== wi);
                              updateTreatment(idx, { allowedWindows: next.length ? next : undefined });
                            }}
                            className="mt-6 text-xs px-3 py-2 rounded-full bg-rose-50 border border-rose-200 text-rose-800 font-semibold hover:bg-rose-100"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-slate-500">Sin ventanas: puede ir en cualquier hora.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">No hay tratamientos. Elige uno del desplegable para empezar.</p>
        )}
      </div>

      {/* Reglas extra */}
      <div className="mt-4 rounded-3xl bg-white p-5 border border-slate-100">
        <p className="text-sm font-bold text-slate-900">Reglas extra (texto)</p>
        <textarea
          className="mt-3 w-full min-h-[96px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
          placeholder="Ej: No mover endodoncias. No compactar si hay anestesia. Etc."
          value={rules.extraRulesText ?? ""}
          onChange={(e) => set({ extraRulesText: e.target.value })}
        />
      </div>

      <div className="mt-4 text-[11px] text-slate-500">
        Treatments activos: <b>{treatments.length}</b>
      </div>
    </section>
  );
}
