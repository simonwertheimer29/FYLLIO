// app/components/no-shows/AgendaCalendar.tsx
// FullCalendar week/day view for the no-shows module.
// Loads from /api/no-shows/agenda, applies risk-score colors,
// handles DnD via FullCalendar's built-in eventDrop/eventResize.
"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useState, useEffect, useRef } from "react";
import { DateTime } from "luxon";
import type { NoShowsUserSession, RiskyAppt, GapSlot } from "../../lib/no-shows/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgendaDay = { dayIso: string; appointments: RiskyAppt[]; gaps: GapSlot[] };
type AgendaData = { week: string; days: AgendaDay[]; isDemo?: boolean };

export type Props = {
  user: NoShowsUserSession;
  /** Monday ISO — used for data loading */
  week: string;
  /** Specific date FullCalendar navigates to (= week in week mode, specific day in day mode) */
  calendarDate: string;
  viewMode: "timeGridFiveDays" | "timeGridDay";
  clinicaFilter?: string;
  /** Increment to trigger a data reload */
  refreshKey: number;
  onApptClick: (appt: RiskyAppt) => void;
  onNewAppt: (dayIso: string, startMin: number) => void;
  onToast: (msg: string, ok?: boolean) => void;
  onClinciasAvailable?: (clinicas: string[]) => void;
  /** Fires whenever FullCalendar navigates — provides monday ISO + formatted label */
  onDatesSet?: (mondayIso: string, label: string) => void;
};

// ── Color helpers ─────────────────────────────────────────────────────────────

function apptColors(appt: RiskyAppt): { bg: string; border: string } {
  if (appt.confirmed)       return { bg: "#2563EB", border: "#1d4ed8" };
  if (appt.riskScore >= 61) return { bg: "#DC2626", border: "#b91c1c" };
  if (appt.riskScore >= 31) return { bg: "#D97706", border: "#b45309" };
  return                         { bg: "#16A34A", border: "#15803d" };
}

// ── FullCalendar "fake-date" helpers ──────────────────────────────────────────
// FullCalendar with timeZone="Europe/Madrid" produces dates where
// UTC components = Madrid local time. We re-interpret them correctly.

function toRealUtcIso(fakeDate: Date): string {
  return DateTime.fromObject(
    {
      year:   fakeDate.getUTCFullYear(),
      month:  fakeDate.getUTCMonth() + 1,
      day:    fakeDate.getUTCDate(),
      hour:   fakeDate.getUTCHours(),
      minute: fakeDate.getUTCMinutes(),
      second: fakeDate.getUTCSeconds(),
    },
    { zone: "Europe/Madrid" },
  ).toUTC().toISO()!;
}

function fakeDateParts(d: Date): { dayIso: string; startMin: number } {
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { dayIso: `${y}-${m}-${dd}`, startMin: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function fakeToHHMM(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgendaCalendar({
  week,
  calendarDate,
  viewMode,
  clinicaFilter,
  refreshKey,
  onApptClick,
  onNewAppt,
  onToast,
  onClinciasAvailable,
  onDatesSet,
}: Props) {
  const [data, setData]       = useState<AgendaData | null>(null);
  const [loading, setLoading] = useState(true);
  const calRef          = useRef<InstanceType<typeof FullCalendar>>(null);
  const programmaticRef = useRef(false);

  // Keep stable refs so async callbacks (eventDrop etc.) always use current values
  const weekRef            = useRef(week);
  const clinicaFilterRef   = useRef(clinicaFilter);
  const onClinciasRef      = useRef(onClinciasAvailable);
  const onToastRef         = useRef(onToast);
  useEffect(() => { weekRef.current          = week;               }, [week]);
  useEffect(() => { clinicaFilterRef.current = clinicaFilter;      }, [clinicaFilter]);
  useEffect(() => { onClinciasRef.current    = onClinciasAvailable; }, [onClinciasAvailable]);
  useEffect(() => { onToastRef.current       = onToast;             }, [onToast]);

  async function load() {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/agenda", location.href);
      url.searchParams.set("week", weekRef.current);
      if (clinicaFilterRef.current) url.searchParams.set("clinica", clinicaFilterRef.current);
      const res = await fetch(url.toString());
      if (res.ok) {
        const json: AgendaData = await res.json();
        setData(json);
        onClinciasRef.current?.(
          [...new Set(
            json.days.flatMap((d) => d.appointments.map((a) => a.clinica)).filter(Boolean) as string[]
          )].sort(),
        );
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  // Reload when week / filter / external refreshKey change
  useEffect(() => { loadRef.current(); }, [week, clinicaFilter, refreshKey]);

  // Navigate FullCalendar to specific date
  // setTimeout avoids flushSync-inside-render error triggered by FullCalendar internals
  useEffect(() => {
    if (!calRef.current) return;
    programmaticRef.current = true;
    setTimeout(() => calRef.current?.getApi().gotoDate(calendarDate), 0);
  }, [calendarDate]);

  // Switch FullCalendar between week and day view
  useEffect(() => {
    if (!calRef.current) return;
    setTimeout(() => calRef.current?.getApi().changeView(viewMode), 0);
  }, [viewMode]);

  // ── Build events ────────────────────────────────────────────────────────────

  const apptEvents = (data?.days ?? []).flatMap(({ appointments }) =>
    appointments.map((appt) => {
      const { bg, border } = apptColors(appt);
      // Ensure end is always after start so blocks are visible and resizable
      const end = (appt.end && appt.end !== appt.start)
        ? appt.end
        : DateTime.fromISO(appt.start, { zone: "Europe/Madrid" }).plus({ minutes: 30 }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
      return {
        id:              appt.id,
        start:           appt.start,
        end,
        title:           appt.patientName,
        backgroundColor: bg,
        borderColor:     border,
        textColor:       "#ffffff",
        extendedProps:   { appt },
      };
    }),
  );

  const gapEvents = (data?.days ?? []).flatMap(({ gaps }) =>
    gaps.map((gap) => ({
      id:              `gap-${gap.startIso}`,
      start:           gap.startIso,
      end:             gap.endIso,
      display:         "background" as const,
      backgroundColor: "#D1FAE5",
    })),
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden flex-1 min-h-0 flex flex-col">
      {data?.isDemo && !loading && (
        <div className="px-4 py-2 border-b border-amber-200 bg-amber-50 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales. El DnD no persiste en modo demo.
        </div>
      )}
      {loading && (
        <div className="px-4 py-1.5 border-b border-slate-100 bg-slate-50 text-xs text-slate-400">
          Cargando agenda...
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView={viewMode}
          timeZone="Europe/Madrid"
          locale="es"
          firstDay={1}
          initialDate={calendarDate}
          slotMinTime="08:00:00"
          slotMaxTime="20:00:00"
          height="100%"
          headerToolbar={false}
          hiddenDays={[0]}
          views={{
            timeGridFiveDays: {
              type: "timeGrid",
              duration: { days: 5 },
            },
          }}
          // datesSet fires after every navigation — keeps parent header in sync
          datesSet={(info) => {
            // Fake-UTC dates: UTC components = Madrid local time
            const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
            const s = info.start;
            const e = new Date(info.end);
            e.setUTCDate(e.getUTCDate() - 1); // last visible day
            const sD = s.getUTCDate(), sM = s.getUTCMonth();
            const eD = e.getUTCDate(), eM = e.getUTCMonth(), eY = e.getUTCFullYear();
            const label = sM === eM
              ? `${sD}–${eD} ${MONTHS[sM]} ${eY}`
              : `${sD} ${MONTHS[sM]}–${eD} ${MONTHS[eM]} ${eY}`;
            const mondayIso = `${s.getUTCFullYear()}-${String(sM + 1).padStart(2, "0")}-${String(sD).padStart(2, "0")}`;
            onDatesSet?.(mondayIso, label);
          }}
          allDaySlot={false}
          nowIndicator={true}
          editable={!data?.isDemo}
          eventResizableFromStart={false}
          selectable={true}
          selectMirror={true}
          events={[...apptEvents, ...gapEvents]}
          // ── Event block content ───────────────────────────────────────────
          eventContent={(arg) => {
            const appt = arg.event.extendedProps.appt as RiskyAppt | undefined;
            if (!appt) return; // background gap events — FullCalendar renders natively
            const startStr = arg.event.start ? fakeToHHMM(arg.event.start) : "";
            const endStr   = arg.event.end   ? fakeToHHMM(arg.event.end)   : "";
            return (
              <div style={{ padding: "2px 4px", overflow: "hidden", height: "100%", display: "flex", flexDirection: "column", gap: "1px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {appt.patientName}
                </div>
                <div style={{ fontSize: "10px", fontWeight: 600, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.88 }}>
                  {appt.treatmentName}
                </div>
                <div style={{ fontSize: "9px", lineHeight: 1, opacity: 0.82 }}>
                  {startStr}{endStr ? `–${endStr}` : ""}
                </div>
                {!appt.confirmed && (
                  <div style={{ fontSize: "8px", lineHeight: 1, opacity: 0.72 }}>sin conf.</div>
                )}
              </div>
            );
          }}
          // ── Click → SidePanel ─────────────────────────────────────────────
          eventClick={(info) => {
            const appt = info.event.extendedProps.appt as RiskyAppt | undefined;
            if (!appt) return;
            onApptClick(appt);
          }}
          // ── Select slot → NewApptModal ────────────────────────────────────
          select={(info) => {
            const { dayIso, startMin } = fakeDateParts(info.start);
            const snapped = Math.max(8 * 60, Math.min(19 * 60, Math.round(startMin / 15) * 15));
            onNewAppt(dayIso, snapped);
          }}
          // ── Drag to move ──────────────────────────────────────────────────
          eventDrop={async (info) => {
            const appt = info.event.extendedProps.appt as RiskyAppt | undefined;
            if (!appt || data?.isDemo) { info.revert(); return; }
            try {
              const res = await fetch(`/api/no-shows/agenda/${appt.id}/mover`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  startIso: toRealUtcIso(info.event.start!),
                  endIso:   toRealUtcIso(info.event.end!),
                }),
              });
              if (!res.ok) throw new Error();
              loadRef.current();
            } catch {
              onToastRef.current("Error al mover la cita.");
              info.revert();
            }
          }}
          // ── Resize duration ───────────────────────────────────────────────
          eventResize={async (info) => {
            const appt = info.event.extendedProps.appt as RiskyAppt | undefined;
            if (!appt || data?.isDemo) { info.revert(); return; }
            try {
              const res = await fetch(`/api/no-shows/agenda/${appt.id}/mover`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  startIso: toRealUtcIso(info.event.start!),
                  endIso:   toRealUtcIso(info.event.end!),
                }),
              });
              if (!res.ok) throw new Error();
              loadRef.current();
            } catch {
              onToastRef.current("Error al cambiar duración.");
              info.revert();
            }
          }}
        />
      </div>
    </div>
  );
}
