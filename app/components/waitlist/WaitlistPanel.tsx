"use client";

import { useEffect, useMemo, useState } from "react";

type WaitItem = {
  id: string;
  waitingId?: string;
  estado?: string;
  prioridad?: string | number;
  preferencia?: string;
  rango?: string;
  ultimoContacto?: string;
  notas?: string;

  // opcionales (si luego los traes por API)
  paciente?: string[] | string;
  tratamiento?: string[] | string;
  profesional?: string[] | string;
};

function asText(v: any) {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

function priorityNumber(p: any) {
  const n = Number(p);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function chipClass(estado: string) {
  return estado === "Aceptado"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : estado === "Contactado"
    ? "border-sky-200 bg-sky-50 text-sky-900"
    : estado === "Expirado"
    ? "border-slate-200 bg-slate-100 text-slate-700"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

type ViewMode = "TABLE" | "CARDS";

export default function WaitlistPanel({ clinicRecordId }: { clinicRecordId: string }) {
  const [items, setItems] = useState<WaitItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ default: TABLE
  const [view, setView] = useState<ViewMode>("TABLE");

  async function load() {

    console.log("[waitlist UI] clinicRecordId:", clinicRecordId);
if (!clinicRecordId) {
  setItems([]);
  setLoading(false);
  return;
}

  setLoading(true);
  try {
    const res = await fetch(
      `/api/db/waitlist?clinicRecordId=${encodeURIComponent(clinicRecordId)}`,
      { cache: "no-store" }
    );

    const json = await res.json();
    const data = (json?.waitlist ?? []) as WaitItem[];
    console.log("[waitlist UI] response:", json);


    setItems(data);
  } finally {
    setLoading(false);
  }
}

function toDbEstado(ui: "Esperando" | "Contactado" | "Aceptado" | "Expirado") {
  if (ui === "Esperando") return "ACTIVE";
  if (ui === "Contactado") return "OFFERED";
  if (ui === "Aceptado") return "BOOKED";
  return "EXPIRED";
}




  async function setStatus(
  id: string,
  estado: "Esperando" | "Contactado" | "Aceptado" | "Expirado"
) {
  const dbEstado = toDbEstado(estado);

  await fetch(`/api/db/waitlist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      estado: dbEstado,
      ultimoContacto:
        estado === "Contactado" ? new Date().toISOString() : undefined,
    }),
  });

  await load();
}


  const sorted = useMemo(() => {
    const copy = items.slice();
    copy.sort((a, b) => {
      // prioridad desc
      const pa = priorityNumber(a.prioridad);
      const pb = priorityNumber(b.prioridad);
      if (pb !== pa) return pb - pa;

      // esperando primero
      const ea = (a.estado ?? "") === "Esperando" ? 0 : 1;
      const eb = (b.estado ?? "") === "Esperando" ? 0 : 1;
      if (ea !== eb) return ea - eb;

      return String(a.waitingId ?? a.id).localeCompare(String(b.waitingId ?? b.id));
    });
    return copy;
  }, [items]);

  const nextToContact = useMemo(() => {
    return sorted.find((x) => (x.estado ?? "") === "Esperando") ?? null;
  }, [sorted]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicRecordId]);

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Lista de espera</h2>
          <p className="text-xs text-slate-600 mt-1">Conectado a Airtable</p>

        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* ✅ toggle TABLE/CARDS */}
          <div className="rounded-full border border-slate-200 bg-white p-1 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setView("TABLE")}
              className={view === "TABLE" ? "rounded-full px-3 py-1 bg-slate-900 text-white" : "rounded-full px-3 py-1 text-slate-700"}
            >
              Tabla
            </button>
            <button
              type="button"
              onClick={() => setView("CARDS")}
              className={view === "CARDS" ? "rounded-full px-3 py-1 bg-slate-900 text-white" : "rounded-full px-3 py-1 text-slate-700"}
            >
              Cards
            </button>
          </div>

          <button className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50" onClick={load} type="button">
            Refrescar
          </button>

        </div>
      </div>

      {/* CTA FINAL */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wide">Siguiente recomendado</p>
          {nextToContact ? (
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {asText(nextToContact.paciente) || nextToContact.waitingId || nextToContact.id} · Prioridad{" "}
              <b>{priorityNumber(nextToContact.prioridad)}</b> · {nextToContact.preferencia ?? "Indiferente"}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">No hay pacientes “Esperando”.</p>
          )}
        </div>

        <button
          type="button"
          disabled={!nextToContact}
          onClick={() => nextToContact && setStatus(nextToContact.id, "Contactado")}
          className="text-xs px-4 py-2 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          Contactar siguiente
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Cargando...</p>
      ) : sorted.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No hay pacientes en espera.</p>
      ) : view === "TABLE" ? (
        // ✅ TABLE VIEW (default)
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs text-slate-600">
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Prioridad</th>
                <th className="px-4 py-3 font-semibold">Preferencia</th>
                <th className="px-4 py-3 font-semibold">Rango</th>
                <th className="px-4 py-3 font-semibold">Tratamiento</th>
                <th className="px-4 py-3 font-semibold">Profesional</th>
                <th className="px-4 py-3 font-semibold">Últ. contacto</th>
    
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {sorted.map((it) => {
                const estado = it.estado ?? "—";
                const pr = priorityNumber(it.prioridad);
                const disabledContact = estado === "Contactado" || estado === "Aceptado" || estado === "Expirado";
                const disabledAccepted = estado === "Aceptado" || estado === "Expirado";
                const disabledExpired = estado === "Expirado";

                return (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{asText(it.paciente) || it.waitingId || it.id}</div>
                      {it.notas ? <div className="text-xs text-slate-500 mt-1 line-clamp-1">{it.notas}</div> : null}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[11px] px-3 py-1 rounded-full border font-semibold ${chipClass(estado)}`}>{estado}</span>
                    </td>

                    <td className="px-4 py-3">
                      <span className="inline-flex text-[11px] px-3 py-1 rounded-full border border-slate-200 bg-white font-semibold text-slate-700">
                        {pr || "—"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-slate-700">{it.preferencia ?? "Indiferente"}</td>
                    <td className="px-4 py-3 text-slate-700">{it.rango ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{asText(it.tratamiento) || "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{asText(it.profesional) || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(it.ultimoContacto)}</td>

                
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // ✅ CARDS VIEW (optional)
        <div className="mt-4 space-y-3">
          {sorted.map((it) => {
            const estado = it.estado ?? "—";
            const pr = priorityNumber(it.prioridad);

            const disabledContact = estado === "Contactado" || estado === "Aceptado" || estado === "Expirado";
            const disabledAccepted = estado === "Aceptado" || estado === "Expirado";
            const disabledExpired = estado === "Expirado";

            return (
              <div key={it.id} className="rounded-2xl border border-slate-200 p-4 bg-white">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-extrabold text-slate-900">{asText(it.paciente) || it.waitingId || it.id}</p>
                      <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold ${chipClass(estado)}`}>{estado}</span>
                      <span className="text-[11px] px-3 py-1 rounded-full border border-slate-200 bg-white font-semibold text-slate-700">
                        Prioridad {pr || "—"}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-slate-600">
                      Preferencia: <b>{it.preferencia ?? "Indiferente"}</b> · Rango: <b>{it.rango ?? "—"}</b>
                    </p>

                    {it.tratamiento || it.profesional ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Tratamiento: <b>{asText(it.tratamiento) || "—"}</b> · Profesional: <b>{asText(it.profesional) || "—"}</b>
                      </p>
                    ) : null}

                    {it.ultimoContacto ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Último contacto: <b>{fmtDate(it.ultimoContacto)}</b>
                      </p>
                    ) : null}

                    {it.notas ? <p className="mt-3 text-sm text-slate-700">{it.notas}</p> : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      className="text-xs px-3 py-2 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
                      onClick={() => setStatus(it.id, "Contactado")}
                      disabled={disabledContact}
                      type="button"
                    >
                      {estado === "Contactado" ? "Contactado" : "Contactar"}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => setStatus(it.id, "Aceptado")}
                        disabled={disabledAccepted}
                        type="button"
                      >
                        Aceptado
                      </button>

                      <button
                        className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => setStatus(it.id, "Expirado")}
                        disabled={disabledExpired}
                        type="button"
                      >
                        Expirar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
