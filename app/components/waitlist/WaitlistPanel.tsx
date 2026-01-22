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

const DEMO_ITEMS: WaitItem[] = [
  {
    id: "demo_1",
    waitingId: "W-001",
    estado: "Esperando",
    prioridad: 5,
    preferencia: "Mañana",
    rango: "09:00–12:00",
    notas: "Dolor / urgencia leve",
    paciente: "María López",
    tratamiento: "Endodoncia",
    profesional: "Dr. A",
  },
  {
    id: "demo_2",
    waitingId: "W-002",
    estado: "Esperando",
    prioridad: 4,
    preferencia: "Tarde",
    rango: "16:00–19:00",
    notas: "Control anual",
    paciente: "Carlos Ruiz",
    tratamiento: "Revisión",
    profesional: "Dr. A",
  },
  {
    id: "demo_3",
    waitingId: "W-003",
    estado: "Contactado",
    prioridad: 3,
    preferencia: "Indiferente",
    rango: "Cualquier horario",
    notas: "Prefiere WhatsApp",
    ultimoContacto: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    paciente: "Sofía Díaz",
    tratamiento: "Limpieza",
    profesional: "Dr. B",
  },
];

function asText(v: any) {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

function priorityNumber(p: any) {
  const n = Number(p);
  return Number.isFinite(n) ? n : 0;
}

export default function WaitlistPanel({ clinicRecordId }: { clinicRecordId: string }) {
  const isDemo = clinicRecordId === "DEMO";

  const [items, setItems] = useState<WaitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingDemoData, setUsingDemoData] = useState<boolean>(isDemo);

  async function load() {
    if (isDemo) {
      setItems(DEMO_ITEMS);
      setUsingDemoData(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/waitlist?clinicRecordId=${encodeURIComponent(clinicRecordId)}`);
      const json = await res.json();
      const data = (json?.data ?? []) as WaitItem[];

      if (!data.length) {
        // si Airtable aún está vacío, mostramos demo para que el dashboard se vea vivo
        setItems(DEMO_ITEMS);
        setUsingDemoData(true);
      } else {
        setItems(data);
        setUsingDemoData(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(id: string, estado: "Esperando" | "Contactado" | "Aceptado" | "Expirado") {
    // modo demo: solo actualizar local
    if (usingDemoData) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                estado,
                ...(estado === "Contactado" ? { ultimoContacto: new Date().toISOString() } : {}),
              }
            : x
        )
      );
      return;
    }

    await fetch(`/api/waitlist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado,
        ultimoContacto: estado === "Contactado" ? new Date().toISOString() : undefined,
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
          <p className="text-xs text-slate-600 mt-1">
            {usingDemoData ? "Modo demo (sin Airtable todavía)" : "Conectado a Airtable"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50" onClick={load} type="button">
            Refrescar
          </button>

          {usingDemoData ? (
            <button
              className="text-xs px-3 py-2 rounded-full bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => setItems(DEMO_ITEMS)}
              type="button"
            >
              Cargar demo
            </button>
          ) : null}
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
      ) : (
        <div className="mt-4 space-y-3">
          {sorted.map((it) => {
            const estado = it.estado ?? "—";
            const pr = priorityNumber(it.prioridad);

            const chip =
              estado === "Aceptado"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : estado === "Contactado"
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : estado === "Expirado"
                ? "border-slate-200 bg-slate-100 text-slate-700"
                : "border-amber-200 bg-amber-50 text-amber-900";

            return (
              <div key={it.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-extrabold text-slate-900">
                        {asText(it.paciente) || it.waitingId || it.id}
                      </p>
                      <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold ${chip}`}>
                        {estado}
                      </span>
                      <span className="text-[11px] px-3 py-1 rounded-full border border-slate-200 bg-white font-semibold text-slate-700">
                        Prioridad {pr || "—"}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-slate-600">
                      Preferencia: <b>{it.preferencia ?? "Indiferente"}</b> · Rango: <b>{it.rango ?? "—"}</b>
                    </p>

                    {(it.tratamiento || it.profesional) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Tratamiento: <b>{asText(it.tratamiento) || "—"}</b> · Profesional: <b>{asText(it.profesional) || "—"}</b>
                      </p>
                    ) : null}

                    {it.ultimoContacto ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Último contacto: <b>{new Date(it.ultimoContacto).toLocaleString()}</b>
                      </p>
                    ) : null}

                    {it.notas ? <p className="mt-3 text-sm text-slate-700">{it.notas}</p> : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      className="text-xs px-3 py-2 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
                      onClick={() => setStatus(it.id, "Contactado")}
                      disabled={estado === "Contactado" || estado === "Aceptado" || estado === "Expirado"}
                      type="button"
                    >
                      {estado === "Contactado" ? "Contactado" : "Contactar"}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => setStatus(it.id, "Aceptado")}
                        disabled={estado === "Aceptado" || estado === "Expirado"}
                        type="button"
                      >
                        Aceptado
                      </button>

                      <button
                        className="text-xs px-3 py-2 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => setStatus(it.id, "Expirado")}
                        disabled={estado === "Expirado"}
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
