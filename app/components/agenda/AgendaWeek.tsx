"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgendaItem, RulesState } from "../../lib/types";
import { parseLocal } from "../../lib/time";
import { DateTime } from "luxon";

type Props = {
  items: AgendaItem[];
  rules: RulesState;
  anchorDayIso: string;
  onItemOpen?: (item: AgendaItem) => void;
  onItemChange?: (nextItem: AgendaItem) => void;
};

function msToLocalIsoNoTz(ms: number, tz: string) {
  return DateTime.fromMillis(ms).setZone(tz).toFormat("yyyy-LL-dd'T'HH:mm:ss");
}

function hashStringToHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function diffMinutesExact(aIso: string, bIso: string) {
  return (parseLocal(bIso).getTime() - parseLocal(aIso).getTime()) / 60000;
}

const TREATMENT_HUES = [0, 25, 50, 90, 130, 160, 200, 220, 250, 280, 310, 340];

function treatmentTextColor(treatment: string) {
  const h = hashStringToHue((treatment || "").toLowerCase());
  const hue = TREATMENT_HUES[h % TREATMENT_HUES.length];
  return `hsl(${hue} 85% 32%)`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function dateOnly(iso: string) {
  return iso.slice(0, 10);
}
function startOfWeekMondayLocal(anchorIso: string) {
  const d = parseLocal(anchorIso);
  const day = d.getDay();
  const deltaToMonday = (day + 6) % 7;
  const monday = new Date(d.getTime() - deltaToMonday * 24 * 60 * 60 * 1000);
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}
function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + m;
}
function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isLunchBlock(it: AgendaItem) {
  return it.kind === "AI_BLOCK" && String(it.id).startsWith("RULE_LUNCH:");
}

function isSimFilledAppt(it: AgendaItem) {
  return it.kind === "APPOINTMENT" && String(it.id).startsWith("SIM_");
}

function getBlockNote(it: AgendaItem) {
  const anyIt = it as any;

  const fromMeta = String(
    anyIt?.meta?.note ??
      anyIt?.meta?.notes ??
      anyIt?.meta?.description ??
      anyIt?.meta?.info ??
      ""
  ).trim();

  const direct = String(
    anyIt?.note ?? anyIt?.notes ?? anyIt?.description ?? anyIt?.info ?? ""
  ).trim();

  return (direct || fromMeta || "").trim();
}

function labelForBlock(it: AgendaItem) {
  if (it.kind !== "AI_BLOCK") return "";

  if (isLunchBlock(it)) return "Almuerzo";

  if ((it as any).blockType === "INTERNAL") return (it.label ?? "").trim() || "Tiempo interno";
  if ((it as any).blockType === "PERSONAL") return (it.label ?? "").trim() || "Tiempo personal";

  if (it.blockType === "BREAK") return it.label ?? "Descanso";
  if (it.blockType === "BUFFER") return it.label ?? "Buffer";

  return (it.label ?? "").trim() || "Bloque";
}

function itemPrimaryText(it: AgendaItem) {
  if (it.kind === "APPOINTMENT") return (it as any).patientName ?? (it as any).label ?? "Cita";
  if (it.kind === "GAP") return "Tiempo disponible";
  if (it.kind === "AI_BLOCK") return labelForBlock(it);
  return (it as any).label ?? "Bloque";
}

const glowBase =
  "bg-[length:200%_200%] [animation:gradmove_3s_ease_infinite] " +
  "shadow-[0_0_0_2px_rgba(0,0,0,0.04),0_18px_44px_rgba(0,0,0,0.10)]";

const glowBlue = `border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50 to-sky-100 ${glowBase}`;
const glowPurple = `border-violet-200 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-violet-100 ${glowBase}`;
const glowOrange = `border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 ${glowBase}`;

function itemCardClass(it: AgendaItem) {
  if (it.kind === "GAP") {
    const st = it.meta?.status ?? "OPEN";
    if (st === "CONTACTING") return "border-sky-200 bg-sky-50 shadow-[0_0_0_2px_rgba(56,189,248,0.12)]";
    return "border-emerald-200 bg-emerald-50";
  }

  if (it.kind === "AI_BLOCK") {
    if (it.blockType === "PERSONAL") return glowPurple;
    if (it.blockType === "INTERNAL") return glowOrange;
    if (it.blockType === "BREAK") return "border-sky-200 bg-sky-50";
    if (it.blockType === "BUFFER") return "border-slate-200 bg-slate-100";
    return "border-slate-200 bg-slate-50";
  }

  if (isSimFilledAppt(it)) return glowBlue;
  if ((it as any).changed) return "border-sky-200 bg-sky-50 shadow-[0_0_0_2px_rgba(56,189,248,0.14)]";
  return "border-slate-200 bg-white";
}

/* ---------------- Filled / hyphen layout ---------------- */

function hyphenWrap(text: string, maxCharsPerLine: number, maxLines: number) {
  const s = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let i = 0;

  while (i < s.length && lines.length < maxLines) {
    while (s[i] === " ") i++;
    if (i >= s.length) break;

    const remaining = s.length - i;
    if (remaining <= maxCharsPerLine) {
      lines.push(s.slice(i));
      break;
    }

    const end = i + maxCharsPerLine;

    if (s[end] === " ") {
      lines.push(s.slice(i, end));
      i = end + 1;
      continue;
    }

    const prev = s[end - 1];
    const next = s[end];
    const insideWord = prev !== " " && next !== " ";

    if (insideWord) {
      lines.push(s.slice(i, end - 1) + "-");
      i = end - 1;
    } else {
      lines.push(s.slice(i, end));
      i = end;
    }
  }

  if (i < s.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/-?$/, "…");
  }

  return lines;
}

function computeWrappedLines(params: {
  text: string;
  widthPx: number;
  heightPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  paddingX: number;
  paddingY: number;
}) {
  const { text, widthPx, heightPx, fontSizePx, lineHeightPx, paddingX, paddingY } = params;

  const innerW = Math.max(40, widthPx - paddingX);
  const innerH = Math.max(24, heightPx - paddingY);

  const maxLines = clampInt(Math.floor(innerH / lineHeightPx), 1, 20);

  const avgCharPx = fontSizePx * 0.58;
  const baseMaxChars = clampInt(Math.floor(innerW / avgCharPx), 2, 30);

  const hi = baseMaxChars;
  const lo = 2;

  const targetLines = maxLines;

  let bestChars = hi;
  let bestLines = hyphenWrap(text, hi, maxLines).length;

  let L = lo;
  let R = hi;
  while (L <= R) {
    const mid = Math.floor((L + R) / 2);
    const lines = hyphenWrap(text, mid, maxLines).length;

    if (lines >= targetLines) {
      bestChars = mid;
      bestLines = lines;
      L = mid + 1;
    } else {
      R = mid - 1;
    }
  }

  if (bestLines < maxLines && text.length > bestChars) {
    const tighter = clampInt(bestChars - 1, 2, hi);
    const tighterLines = hyphenWrap(text, tighter, maxLines).length;
    if (tighterLines > bestLines) bestChars = tighter;
  }

  return { lines: hyphenWrap(text, bestChars, maxLines) };
}

function FilledBlockText({ text, fontSizePx = 12, lineHeightPx = 16 }: { text: string; fontSizePx?: number; lineHeightPx?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });

    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const computed = useMemo(() => {
    if (!size.w || !size.h) return { lines: [text] };
    return computeWrappedLines({
      text,
      widthPx: size.w,
      heightPx: size.h,
      fontSizePx,
      lineHeightPx,
      paddingX: 16,
      paddingY: 16,
    });
  }, [text, size.w, size.h, fontSizePx, lineHeightPx]);

  return (
    <div ref={ref} className="h-full w-full flex items-center justify-center px-3">
      <div className="w-full text-center">
        {computed.lines.map((ln, idx) => (
          <div key={idx} className="font-extrabold text-slate-800" style={{ fontSize: fontSizePx, lineHeight: `${lineHeightPx}px` }}>
            {ln}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderContent(params: { it: AgendaItem; heightPx: number; chairs: number }) {
  const { it, heightPx } = params;

  const isAppt = it.kind === "APPOINTMENT";

  // base
  const name = isAppt ? ((it as any).patientName ?? "Sin nombre") : itemPrimaryText(it);
  const treatment = isAppt ? ((it as any).treatment ?? (it as any).type ?? "Tratamiento") : "";

  // extras
  const reason = isAppt ? ((it as any).reason ?? (it as any).notes ?? "") : "";
  const showReason = isAppt && !!reason && heightPx >= 72;
  const timeRange = `${it.start.slice(11, 16)}–${it.end.slice(11, 16)}`;

  const compact = heightPx < 44;

let primary = itemPrimaryText(it);

// ✅ blindaje: si por algún motivo viene contaminado
primary = primary.replace(/sill[oó]n\s*:?\s*\d+/gi, "").trim();
primary = primary.replace(/\s{2,}/g, " ");


  const isBuffer = it.kind === "AI_BLOCK" && it.blockType === "BUFFER";
  const note = getBlockNote(it);
  const isInternalOrPersonal = it.kind === "AI_BLOCK" && (it.blockType === "INTERNAL" || it.blockType === "PERSONAL");
  const hasBlockNote = isInternalOrPersonal && note.length > 0;

  // ---------- NO APPOINTMENT (GAP / AI_BLOCK) ----------
  if (!isAppt) {
    const range = `${it.start.slice(11, 16)}–${it.end.slice(11, 16)}`;

    if (isBuffer && heightPx < 30) {
      return (
        <div className="h-full w-full flex items-center px-2">
          <div className="w-full font-extrabold text-slate-700 truncate" style={{ fontSize: "11px", lineHeight: "1" }} title={`Buf ${range}`}>
            Buf <span className="font-semibold text-slate-600">{range}</span>
          </div>
        </div>
      );
    }

    const tall = heightPx >= 140;
    const narrow = false;


    const shouldFill =
  (it.kind === "AI_BLOCK") &&
  tall &&
  narrow &&
  !isBuffer &&
  !isInternalOrPersonal &&
  !hasBlockNote;


    if (shouldFill) return <FilledBlockText text={primary} fontSizePx={12} lineHeightPx={16} />;

    if (isBuffer && heightPx < 18) {
      return (
        <div className="h-full w-full flex items-center px-2">
          <div className="font-extrabold text-slate-700 truncate" style={{ fontSize: "10px", lineHeight: "1" }}>
            Buf
          </div>
        </div>
      );
    }

    const blockRange = `${it.start.slice(11, 16)}–${it.end.slice(11, 16)}`;
    const primaryCompact = isBuffer ? "Buf" : primary;

    return (
      <div className={`h-full w-full flex flex-col items-start justify-start ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}>
        <div className="w-full font-extrabold text-slate-900 truncate" style={{ fontSize: "clamp(9px, 1.05vw, 12px)", lineHeight: "1" }} title={primary}>
          {primaryCompact}
        </div>

        {!isBuffer || heightPx >= 26 ? (
          <div className="w-full text-slate-600 truncate" style={{ fontSize: "clamp(9px, 1.0vw, 11px)", lineHeight: "1" }} title={blockRange}>
            {blockRange}
          </div>
        ) : null}

        {(() => {
          const noteNow = getBlockNote(it);
          const isIP = it.kind === "AI_BLOCK" && (it.blockType === "INTERNAL" || it.blockType === "PERSONAL");
          const showNote = isIP && !!noteNow && heightPx >= 54;
          if (!showNote) return null;

          return (
            <div
              className="w-full text-slate-700"
              style={{
                fontSize: "clamp(9px, 0.95vw, 11px)",
                lineHeight: "1.15",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              title={noteNow}
            >
              {noteNow}
            </div>
          );
        })()}
      </div>
    );
  }

  // ---------- APPOINTMENT ----------
  const chairLabel = String((it as any).chairLabel ?? "").trim();
  const chairText = chairLabel
    ? chairLabel.startsWith("CHR_")
      ? `Sillón: ${chairLabel.replace("CHR_", "")}`
      : `Sillón: ${chairLabel}`
    : `Sillón: ${it.chairId ?? 1}`;

  return (
    <div className={`h-full w-full flex flex-col items-start justify-start ${compact ? "px-1 py-0.5 gap-0" : "px-1.5 py-1 gap-0.5"}`}>
      <div className="w-full font-extrabold text-slate-900 truncate" style={{ fontSize: "clamp(10px, 1.35vw, 14px)", lineHeight: "1.05" }} title={name}>
        {name}
      </div>

      <div
        className="w-full truncate font-semibold"
        style={{
          fontSize: "clamp(9px, 1.15vw, 12px)",
          lineHeight: "1",
          color: treatmentTextColor(treatment),
        }}
        title={treatment}
      >
        {treatment}
      </div>

      <div className="w-full text-slate-600 truncate" style={{ fontSize: "clamp(9px, 1.0vw, 11px)", lineHeight: "1" }} title={timeRange}>
        {timeRange}
      </div>

      <div className="w-full text-slate-500 truncate" style={{ fontSize: "clamp(9px, 1.0vw, 11px)", lineHeight: "1" }} title={chairText}>
        {chairText}
      </div>

      {showReason ? (
        <div className="w-full text-slate-700 truncate" style={{ fontSize: "clamp(9px, 1.0vw, 11px)", lineHeight: "1.1" }} title={reason}>
          {reason}
        </div>
      ) : null}
    </div>
  );
}

function uniqueRenderKey(it: AgendaItem) {
  return `${it.kind}:${String(it.id)}`;
}

export default function AgendaWeek({ items, rules, anchorDayIso, onItemOpen }: Props) {
  const tz = "Europe/Madrid";

  // ✅ normaliza items: si vienen startMs/endMs (epoch), conviértelos a start/end string en hora Madrid
  const normalizedItems = useMemo(() => {
    return items.map((it) => {
      const anyIt = it as any;

      if (typeof it.start === "string" && typeof it.end === "string") return it;

      if (typeof anyIt.startMs === "number" && typeof anyIt.endMs === "number") {
        const zone = String(anyIt.tz ?? tz);
        return {
          ...it,
          start: msToLocalIsoNoTz(anyIt.startMs, zone),
          end: msToLocalIsoNoTz(anyIt.endMs, zone),
        };
      }

      return it;
    });
  }, [items, tz]);

  const mondayDate = useMemo(() => startOfWeekMondayLocal(anchorDayIso), [anchorDayIso]);

  const days = useMemo(() => {
    const out: { key: string; label: string; date: string; enabled: boolean }[] = [];

    const labels = rules.workSat ? ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] : ["Lun", "Mar", "Mié", "Jue", "Vie"];
    const daysCount = rules.workSat ? 6 : 5;

    const base = new Date(`${mondayDate}T00:00:00`);
    for (let i = 0; i < daysCount; i++) {
      const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
      const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      out.push({ key: date, label: labels[i]!, date, enabled: true });
    }

    return out;
  }, [mondayDate, rules.workSat]);

  // ✅ 1 sola columna (no por sillón)
  const chairs = 1;

  const dayStartMin = hhmmToMin(rules.dayStartTime);
  const dayEndMin = hhmmToMin(rules.dayEndTime);
  const totalMin = Math.max(60, dayEndMin - dayStartMin);

  const PX_PER_MIN = 2;
  const gridHeight = totalMin * PX_PER_MIN;

  const hours = useMemo(() => {
    const startH = Math.floor(dayStartMin / 60);
    const endH = Math.ceil(dayEndMin / 60);
    const out: number[] = [];
    for (let h = startH; h <= endH; h++) out.push(h);
    return out;
  }, [dayStartMin, dayEndMin]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const d of days) map.set(d.date, []);

    for (const it of normalizedItems) {
      const d = dateOnly(it.start);
      if (!map.has(d)) continue;
      map.get(d)!.push(it);
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
      map.set(k, arr);
    }
    return map;
  }, [normalizedItems, days]);

  const dayStartIsoFromMin = (date: string) => {
    const hh = Math.floor(dayStartMin / 60);
    const mm = dayStartMin % 60;
    return `${date}T${pad2(hh)}:${pad2(mm)}:00`;
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Agenda · Semana</h2>
          <p className="mt-1 text-sm text-slate-600">
            {rules.workSat ? "L–S" : "L–V"} en una vista semanal. Click en cualquier bloque para detalle.
          </p>
        </div>

        <div className="text-[12px] text-slate-600">
          Horario: <span className="font-semibold">{rules.dayStartTime}–{rules.dayEndTime}</span> · Sillones:{" "}
          <span className="font-semibold">—</span>
        </div>
      </div>

      <div className="p-4">
        <div className="overflow-auto rounded-3xl border border-slate-100">
          <div className="min-w-[1300px]">
            <div className="grid" style={{ gridTemplateColumns: `96px repeat(${days.length}, 1fr)` }}>
              <div className="border-b border-slate-100 bg-white" />
              {days.map((d) => (
                <div key={d.key} className="border-b border-l border-slate-100 bg-white px-4 py-3">
                  <p className="text-sm font-bold text-slate-900">
                    {d.label} <span className="text-slate-500 font-semibold">{d.date.slice(5)}</span>
                  </p>
                  {!d.enabled ? (
                    <p className="text-[11px] text-slate-400">No laborable</p>
                  ) : (
                    <p className="text-[11px] text-slate-500">Agenda</p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid" style={{ gridTemplateColumns: `96px repeat(${days.length}, 1fr)` }}>
              <div className="relative border-r border-slate-100 bg-white" style={{ height: gridHeight }}>
                {hours.map((h) => {
                  const y = (h * 60 - dayStartMin) * PX_PER_MIN;
                  if (y < 0 || y > gridHeight) return null;
                  return (
                    <div key={h} className="absolute left-0 right-0" style={{ top: y }}>
                      <div className="flex items-center gap-2 px-3">
                        <span className="text-[11px] font-semibold text-slate-500">{pad2(h)}:00</span>
                        <div className="h-px flex-1 bg-slate-100" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {days.map((d) => {
                const dayItems = itemsByDay.get(d.date) ?? [];
                const dayStartIso = dayStartIsoFromMin(d.date);

                return (
                  <div key={d.key} className="relative border-l border-slate-100 bg-white" style={{ height: gridHeight }}>
                    {!d.enabled ? <div className="absolute inset-0 bg-slate-50/60" /> : null}

                    <div className="absolute inset-0">
                      <div className="absolute inset-0 pointer-events-none">
                        {hours.map((h) => {
                          const y = (h * 60 - dayStartMin) * PX_PER_MIN;
                          if (y < 0 || y > gridHeight) return null;
                          return <div key={h} className="absolute left-0 right-0 border-t border-slate-50" style={{ top: y }} />;
                        })}
                      </div>

                      {dayItems.map((it, idx) => {
                       const startMin = Math.max(0, Math.round(diffMinutesExact(dayStartIso, it.start)));
const endMin = Math.max(0, Math.round(diffMinutesExact(dayStartIso, it.end)));


                        const isBuffer = it.kind === "AI_BLOCK" && it.blockType === "BUFFER";

                        const durMin = Math.max(1, endMin - startMin);
                        const startY = startMin * PX_PER_MIN;
                        const endY = endMin * PX_PER_MIN;

                        let height = Math.ceil(durMin * PX_PER_MIN);

                        const MIN_APPT_PX = 24;
                        const MIN_BLOCK_PX = 8;
                        height = it.kind === "APPOINTMENT" ? Math.max(MIN_APPT_PX, height) : Math.max(MIN_BLOCK_PX, height);

                        const gapPx = it.kind === "GAP" ? 2 : 0;
                        height = Math.max(MIN_BLOCK_PX, height - gapPx);

                        let top = startY;
                        if (isBuffer && durMin < 10) top = endY - height;

                        top = Math.max(0, Math.min(top, gridHeight - height));
                        height = Math.max(MIN_BLOCK_PX, Math.min(height, gridHeight - top));

                        const cls = itemCardClass(it);
                        const z =
                          it.kind === "AI_BLOCK" && it.blockType === "BUFFER" ? 40 :
                          it.kind === "APPOINTMENT" ? 30 :
                          it.kind === "GAP" ? 20 :
                          10;

                        if (it.kind === "AI_BLOCK" && it.blockType === "BUFFER" && !rules.enableBuffers) return null;

                        return (
                          <button
                            key={`${uniqueRenderKey(it)}::${idx}`}
                            type="button"
                            onClick={() => onItemOpen?.(it)}
                            className={[
                              "absolute left-1 right-5 rounded-lg border text-left",
                              "shadow-[0_6px_16px_rgba(0,0,0,0.08)]",
                              "transition hover:shadow-[0_10px_22px_rgba(0,0,0,0.12)]",
                              "overflow-hidden",
                              cls,
                            ].join(" ")}
                            style={{ top, height, padding: "0px", zIndex: z }}
                          >
                            {renderContent({ it, heightPx: height, chairs })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
