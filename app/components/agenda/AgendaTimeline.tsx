"use client";

import { useMemo } from "react";
import { formatTime, parseLocal } from "../../lib/time";

import type { AgendaItem, RulesState } from "../../lib/types";

type Props = {
  items: AgendaItem[];
  rules: RulesState;
  dayStartIso: string;
  dayEndIso: string;
  onItemOpen?: (item: AgendaItem) => void;
};


function minutesBetweenFloor(aIso: string, bIso: string) {
  const a = parseLocal(aIso).getTime();
  const b = parseLocal(bIso).getTime();
  return Math.max(0, Math.floor((b - a) / 60000));
}

function isSimFilledAppt(it: AgendaItem) {
  return it.kind === "APPOINTMENT" && String(it.id).startsWith("SIM_");
}

// ✅ detecta almuerzo por id (tu builder usa RULE_LUNCH:${date})
function isLunchBlock(it: AgendaItem) {
  return it.kind === "AI_BLOCK" && String(it.id).startsWith("RULE_LUNCH:");
}

const glowBase =
  "bg-[length:200%_200%] [animation:gradmove_3s_ease_infinite] " +
  "shadow-[0_0_0_2px_rgba(0,0,0,0.04),0_18px_44px_rgba(0,0,0,0.10)]";

const glowBlue = `border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50 to-sky-100 ${glowBase}`;
const glowPurple = `border-violet-200 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-violet-100 ${glowBase}`;
const glowOrange = `border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 ${glowBase}`;

function pill(it: AgendaItem) {
  if (it.kind === "GAP") return { text: "TIEMPO DISP.", cls: "bg-emerald-100 border-emerald-200 text-emerald-900" };

  if (it.kind === "AI_BLOCK") {
    // ✅ prioridad: almuerzo
    if (isLunchBlock(it)) return { text: "ALMUERZO", cls: "bg-sky-100 border-sky-200 text-sky-900" };

    if (it.blockType === "PERSONAL") return { text: "PERSONAL", cls: "bg-violet-100 border-violet-200 text-violet-900" };
    if (it.blockType === "INTERNAL") return { text: "INTERNO", cls: "bg-orange-100 border-orange-200 text-orange-900" };
    if (it.blockType === "BREAK") return { text: "DESCANSO", cls: "bg-sky-100 border-sky-200 text-sky-900" };
    if (it.blockType === "BUFFER") return { text: "BUFFER", cls: "bg-slate-200 border-slate-300 text-slate-800" };
    return { text: "BLOQUE", cls: "bg-slate-100 border-slate-200 text-slate-700" };
  }

  if (isSimFilledAppt(it)) return { text: "IA", cls: "bg-sky-100 border-sky-200 text-sky-900" };
  return { text: it.type ?? "CITA", cls: "bg-white border-slate-200 text-slate-700" };
}

function cardStyle(it: AgendaItem) {
  if (it.kind === "GAP") return "border-emerald-200 bg-emerald-50";

  if (it.kind === "AI_BLOCK") {
    if (it.blockType === "PERSONAL") return glowPurple;
    if (it.blockType === "INTERNAL") return glowOrange;

    // ✅ almuerzo con el mismo estilo de break
    if (isLunchBlock(it)) return "border-sky-200 bg-sky-50";

    if (it.blockType === "BREAK") return "border-sky-200 bg-sky-50";
    if (it.blockType === "BUFFER") return "border-slate-200 bg-slate-100";
    return "border-slate-200 bg-slate-50";
  }

  if (isSimFilledAppt(it)) return glowBlue;
  if ((it as any).changed) return "border-sky-200 bg-sky-50";
  return "border-slate-200 bg-white";
}

export default function AgendaTimeline({ items, rules, onItemOpen }: Props) {
  const sorted = useMemo(() => {
  const buffersOff = !rules?.enableBuffers || Number(rules?.bufferMin ?? 0) <= 0;

  return items
    .filter((it) => {
      if (it.kind === "AI_BLOCK" && it.blockType === "BUFFER") {
        // ✅ si buffersOff => no renderizar ninguno
        return !buffersOff;
      }
      return true;
    })
    .slice()
    .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
}, [items, rules]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Agenda · Lista</h2>
          <p className="mt-1 text-sm text-slate-600">Click en cualquier bloque para ver detalle.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-semibold text-sky-900">IA (relleno)</span>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 font-semibold text-violet-900">Personal</span>
          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 font-semibold text-orange-900">Interno</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-900">Tiempo disponible</span>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {sorted.map((it) => {
          const dur = minutesBetweenFloor(it.start, it.end);
          const p = pill(it);
          const style = cardStyle(it);

          const title =
            it.kind === "APPOINTMENT"
              ? (it as any).patientName
              : it.kind === "GAP"
              ? (it as any).label ?? `Tiempo disponible · ${dur} min`
              : // ✅ si es almuerzo, fuerza “Almuerzo” aunque label falle
                isLunchBlock(it)
              ? "Almuerzo"
              : (it as any).label ?? "Bloque";

          const subtitle = `${formatTime(it.start)} – ${formatTime(it.end)} · ${dur} min · S${(it as any).chairId ?? 1}`;

          return (
            <button
key={`${it.kind}:C${(it as any).chairId ?? 1}:${String((it as any).id)}:${it.start}`}

              type="button"
              onClick={() => onItemOpen?.(it)}
              className={[
                "w-full rounded-3xl border text-left px-6 py-5 transition",
                "shadow-[0_10px_26px_rgba(0,0,0,0.06)]",
                "hover:shadow-[0_14px_34px_rgba(0,0,0,0.10)]",
                style,
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-extrabold text-slate-900">{title}</p>
                  <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
                  {(() => {
  const note = ((it as any).note ?? "").trim();
  const show =
    it.kind === "AI_BLOCK" &&
    (it.blockType === "INTERNAL" || it.blockType === "PERSONAL") &&
    !!note;

  if (!show) return null;

  return (
    <p className="mt-2 text-sm text-slate-700" style={{
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    }} title={note}>
      {note}
    </p>
  );
})()}

                  <p className="mt-2 text-sm text-slate-700">Ver detalle →</p>
                </div>

                <span className={["shrink-0 text-[11px] rounded-full border px-3 py-1 font-semibold", p.cls].join(" ")}>
                  {p.text}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
