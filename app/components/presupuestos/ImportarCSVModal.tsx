"use client";

// app/components/presupuestos/ImportarCSVModal.tsx
// Modal 5 pasos para importar presupuestos desde CSV/Excel de Gesden.
// Paso 1: Subir fichero  ·  Paso 2: Mapear columnas  ·  Paso 3: Revisar  ·  Paso 4: Confirmar  ·  Paso 5: Resultado

import { useState, useRef, useMemo } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Presupuesto, UserSession } from "../../lib/presupuestos/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mapeo = {
  paciente: number | null;
  tratamiento: number | null;
  importe: number | null;
  fecha: number | null;
  doctor: number | null;
  tipoPaciente: number | null;
  estado: number | null;
};

type RegistroReview = {
  idx: number;
  paciente: string;
  tratamiento: string;
  importe: number | null;
  fecha: string;
  doctor: string;
  tipoPaciente: string;
  estado: string;
  isDuplicate: boolean;
  ignorar: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_FIELDS: { key: keyof Mapeo; label: string; required: boolean }[] = [
  { key: "paciente",     label: "Paciente",      required: true  },
  { key: "tratamiento",  label: "Tratamiento",   required: true  },
  { key: "importe",      label: "Importe (€)",   required: true  },
  { key: "fecha",        label: "Fecha",         required: false },
  { key: "doctor",       label: "Doctor",        required: false },
  { key: "tipoPaciente", label: "Tipo paciente", required: false },
  { key: "estado",       label: "Estado",        required: false },
];

const ORIGEN_OPTIONS = [
  { value: "",                   label: "Sin especificar" },
  { value: "google_ads",         label: "Google Ads" },
  { value: "seo_organico",       label: "SEO orgánico" },
  { value: "referido_paciente",  label: "Referido" },
  { value: "redes_sociales",     label: "Redes sociales" },
  { value: "walk_in",            label: "Walk-in" },
  { value: "otro",               label: "Otro" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectGesden(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase());
  const keywords = ["paciente", "tratamiento", "descripcion", "precio", "importe", "nhc", "mutua", "presupuesto"];
  return keywords.filter((k) => h.some((col) => col.includes(k))).length >= 3;
}

function autoMapear(headers: string[]): Mapeo {
  const h = headers.map((x) => x.toLowerCase());
  const find = (kws: string[]) => {
    const i = h.findIndex((col) => kws.some((k) => col.includes(k)));
    return i >= 0 ? i : null;
  };
  return {
    paciente:    find(["paciente", "nombre paciente", "patient", "nombre"]),
    tratamiento: find(["tratamiento", "descripcion", "descripción", "servicio", "concepto", "prestacion", "prestación"]),
    importe:     find(["importe", "precio", "total", "pvp", "coste", "valor"]),
    fecha:       find(["fecha"]),
    doctor:      find(["doctor", "médico", "medico", "dentista", "profesional"]),
    tipoPaciente:find(["mutua", "aseguradora", "tipo paciente", "privado"]),
    estado:      find(["estado", "situacion", "situación", "fase"]),
  };
}

function normalizeTipo(raw: string): string {
  const l = raw.toLowerCase();
  if (l.includes("mutua") || l.includes("seguro") || l.includes("ades")) return "Adeslas";
  if (l.includes("priv")) return "Privado";
  return raw;
}

function parseImporte(raw: string): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[€$\s.]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function applyMapeo(rows: string[][], m: Mapeo): RegistroReview[] {
  const get = (row: string[], col: number | null) => col != null ? (row[col] ?? "").trim() : "";
  return rows
    .map((row, idx) => ({
      idx,
      paciente:    get(row, m.paciente),
      tratamiento: get(row, m.tratamiento),
      importe:     parseImporte(get(row, m.importe)),
      fecha:       get(row, m.fecha),
      doctor:      get(row, m.doctor),
      tipoPaciente:normalizeTipo(get(row, m.tipoPaciente)),
      estado:      get(row, m.estado),
      isDuplicate: false,
      ignorar:     false,
    }))
    .filter((r) => r.paciente || r.tratamiento); // drop empty rows
}

function tagDuplicates(registros: RegistroReview[], existentes: Presupuesto[]): RegistroReview[] {
  return registros.map((r) => {
    const nameNorm = r.paciente.toLowerCase().trim();
    if (!nameNorm) return r;
    const isDuplicate = existentes.some((p) => {
      if (p.patientName.toLowerCase().trim() !== nameNorm) return false;
      if (!r.tratamiento) return true; // same name — conservative match
      const t = r.tratamiento.toLowerCase();
      return p.treatments.some(
        (pt) => pt.toLowerCase().slice(0, 5) === t.slice(0, 5) || t.slice(0, 5) === pt.toLowerCase().slice(0, 5)
      );
    });
    return { ...r, isDuplicate, ignorar: isDuplicate };
  });
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ paso }: { paso: number }) {
  const steps = ["Subir", "Mapear", "Revisar", "Confirmar", "Listo"];
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < paso;
        const active = num === paso;
        return (
          <div key={num} className="flex items-center">
            <div className={`flex flex-col items-center gap-0.5 transition-opacity ${active ? "opacity-100" : done ? "opacity-80" : "opacity-30"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-violet-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                {done ? "✓" : num}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? "text-violet-700" : "text-slate-400"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-6 h-px mx-1 mb-3.5 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ImportarCSVModal({
  user,
  existingPresupuestos,
  clinicas,
  onClose,
  onImported,
}: {
  user: UserSession;
  existingPresupuestos: Presupuesto[];
  clinicas: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [paso, setPaso] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);

  // Step 2
  const [mapeo, setMapeo] = useState<Mapeo>({
    paciente: null, tratamiento: null, importe: null,
    fecha: null, doctor: null, tipoPaciente: null, estado: null,
  });

  // Step 3
  const [registros, setRegistros] = useState<RegistroReview[]>([]);

  // Step 4
  const [clinicaId, setClinicaId] = useState(
    user.rol === "encargada_ventas" ? (user.clinica ?? "") : ""
  );
  const [origenDefault, setOrigenDefault] = useState("");

  // Step 5
  const [importing, setImporting] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; errores: string[]; total: number } | null>(null);

  const aImportar = useMemo(() => registros.filter((r) => !r.ignorar), [registros]);
  const ignorados  = useMemo(() => registros.filter((r) => r.ignorar),  [registros]);
  const duplicados = useMemo(() => registros.filter((r) => r.isDuplicate), [registros]);

  // ─── File parsing ───────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    let headers: string[] = [];
    let rows: string[][] = [];

    try {
      if (ext === "csv") {
        const text = await file.text();
        const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
        if (result.data.length > 0) {
          headers = (result.data[0] as string[]).map(String);
          rows = result.data.slice(1) as string[][];
        }
      } else if (ext === "xlsx" || ext === "xls") {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];
        if (data.length > 0) {
          headers = data[0].map(String);
          rows = data.slice(1);
        }
      }
    } catch { return; }

    if (!headers.length) return;

    setRawHeaders(headers);
    setRawRows(rows);

    const m = autoMapear(headers);
    setMapeo(m);

    if (detectGesden(headers)) {
      // Skip mapping step — go straight to review
      const mapped = applyMapeo(rows, m);
      setRegistros(tagDuplicates(mapped, existingPresupuestos));
      setPaso(3);
    } else {
      setPaso(2);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ─── Step 2 → 3 ─────────────────────────────────────────────────────────────

  function applyMappingAndContinue() {
    const mapped = applyMapeo(rawRows, mapeo);
    setRegistros(tagDuplicates(mapped, existingPresupuestos));
    setPaso(3);
  }

  const mappingValid = mapeo.paciente != null || mapeo.tratamiento != null;

  // ─── Step 3 toggle ───────────────────────────────────────────────────────────

  function toggleIgnorar(idx: number) {
    setRegistros((prev) => prev.map((r) => r.idx === idx ? { ...r, ignorar: !r.ignorar } : r));
  }

  // ─── Step 4 → 5 ─────────────────────────────────────────────────────────────

  async function handleImportar() {
    setImporting(true);
    setPaso(5);
    try {
      const res = await fetch("/api/presupuestos/importar-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registros: aImportar.map(({ paciente, tratamiento, importe, fecha, doctor, tipoPaciente, estado }) => ({
            paciente, tratamiento, importe, fecha, doctor, tipoPaciente, estado,
          })),
          clinicaId,
          origenDefault,
        }),
      });
      setResultado(await res.json());
    } catch {
      setResultado({ importados: 0, errores: ["Error de red al importar"], total: aImportar.length });
    } finally {
      setImporting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="font-bold text-slate-900 text-base">Importar CSV Gesden</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {paso < 5 ? `Paso ${paso} de 4` : "Completado"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Stepper paso={paso} />
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 text-xl leading-none ml-1"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {/* ── Paso 1: Subir ──────────────────────────────── */}
          {paso === 1 && (
            <div className="flex flex-col gap-5">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                  isDragging ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-300 hover:bg-slate-50"
                }`}
              >
                <p className="text-4xl">📂</p>
                <p className="font-semibold text-slate-700">Arrastra tu fichero o haz clic para seleccionar</p>
                <p className="text-sm text-slate-400">Formatos: .csv, .xlsx</p>
                <span className="mt-1 text-xs px-4 py-1.5 rounded-xl bg-violet-600 text-white font-semibold">
                  Seleccionar archivo
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500 mb-2">Columnas que detecta automáticamente del export de Gesden:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Paciente", "Fecha", "Doctor", "Descripción / Tratamiento", "Precio", "Mutua/Privado", "Estado"].map((c) => (
                    <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{c}</span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Si se detecta el formato estándar se salta el paso de mapeo.</p>
              </div>
            </div>
          )}

          {/* ── Paso 2: Mapeo ──────────────────────────────── */}
          {paso === 2 && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold text-amber-700">Formato no reconocido automáticamente.</p>
                <p className="text-xs text-amber-600 mt-0.5">Asigna cada campo del sistema a la columna correspondiente de tu fichero.</p>
              </div>

              {/* Preview table */}
              {rawHeaders.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="text-[11px] min-w-full">
                    <thead>
                      <tr className="bg-slate-50">
                        {rawHeaders.map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 border-r border-slate-100 last:border-0 whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0, 3).map((row, ri) => (
                        <tr key={ri} className="border-t border-slate-100">
                          {rawHeaders.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-slate-500 border-r border-slate-100 last:border-0 max-w-[110px] truncate">{row[ci] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Mapping table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-400 pb-2">Campo del sistema</th>
                    <th className="text-left text-xs font-semibold text-slate-400 pb-2">Columna del fichero</th>
                  </tr>
                </thead>
                <tbody>
                  {SYSTEM_FIELDS.map(({ key, label, required }) => (
                    <tr key={key} className="border-b border-slate-50">
                      <td className="py-2 pr-4 text-sm text-slate-700">
                        {label}
                        {required && <span className="ml-1 text-rose-400 text-xs">*</span>}
                      </td>
                      <td className="py-2">
                        <select
                          value={mapeo[key] ?? ""}
                          onChange={(e) =>
                            setMapeo((prev) => ({
                              ...prev,
                              [key]: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        >
                          <option value="">(no mapear)</option>
                          {rawHeaders.map((h, i) => (
                            <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Paso 3: Revisar ─────────────────────────────── */}
          {paso === 3 && (
            <div className="flex flex-col gap-3">
              {/* Summary chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                  {aImportar.length} a importar
                </span>
                {duplicados.length > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">
                    {duplicados.length} posibles duplicados
                  </span>
                )}
                {ignorados.length > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-semibold">
                    {ignorados.length} ignorados
                  </span>
                )}
              </div>

              {duplicados.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Los registros marcados en amarillo ya existen en el sistema. Por defecto se ignoran — pulsa para incluirlos igualmente.
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      {["Paciente", "Tratamiento", "Importe", "Fecha", "Doctor", "Acción"].map((h) => (
                        <th key={h} className={`px-3 py-2 font-semibold text-slate-600 ${h === "Importe" ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {registros.map((r) => (
                      <tr
                        key={r.idx}
                        className={`border-b border-slate-50 last:border-0 transition-opacity ${r.isDuplicate ? "bg-amber-50/60" : ""} ${r.ignorar ? "opacity-35" : ""}`}
                      >
                        <td className="px-3 py-2 font-medium text-slate-700 max-w-[120px] truncate">{r.paciente || "—"}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate">{r.tratamiento || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">
                          {r.importe != null ? `€${r.importe.toLocaleString("es-ES")}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.fecha || "—"}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-[110px] truncate">{r.doctor || "—"}</td>
                        <td className="px-3 py-2 text-center">
                          {r.isDuplicate ? (
                            <button
                              onClick={() => toggleIgnorar(r.idx)}
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                                r.ignorar
                                  ? "bg-slate-200 text-slate-500 hover:bg-emerald-100 hover:text-emerald-700"
                                  : "bg-amber-100 text-amber-700 hover:bg-slate-200 hover:text-slate-500"
                              }`}
                            >
                              {r.ignorar ? "Incluir" : "Ignorar"}
                            </button>
                          ) : (
                            <span className="text-[10px] text-emerald-500 font-medium">Nuevo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Paso 4: Confirmar ──────────────────────────── */}
          {paso === 4 && (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                <p className="text-3xl font-extrabold text-violet-800">{aImportar.length}</p>
                <p className="text-sm text-violet-600 mt-0.5">presupuestos a importar</p>
                {ignorados.length > 0 && (
                  <p className="text-xs text-violet-400 mt-0.5">{ignorados.length} registros ignorados</p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {user.rol !== "encargada_ventas" && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">Asignar a clínica</label>
                    <select
                      value={clinicaId}
                      onChange={(e) => setClinicaId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    >
                      <option value="">Sin clínica asignada</option>
                      {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1.5">Origen lead por defecto</label>
                  <select
                    value={origenDefault}
                    onChange={(e) => setOrigenDefault(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    {ORIGEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">Se aplica a los registros sin canal de origen detectado.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Paso 5: Resultado ──────────────────────────── */}
          {paso === 5 && (
            <div className="flex flex-col items-center gap-5 py-6">
              {importing ? (
                <>
                  <div className="w-10 h-10 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
                  <p className="text-sm text-slate-500">Importando presupuestos en Airtable…</p>
                  <div className="w-full max-w-xs bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full animate-pulse w-2/3" />
                  </div>
                </>
              ) : resultado ? (
                <>
                  <p className="text-5xl">{resultado.errores.length === 0 ? "✅" : "⚠️"}</p>
                  <div className="text-center">
                    <p className="text-3xl font-extrabold text-slate-900">{resultado.importados}</p>
                    <p className="text-sm text-slate-500 mt-0.5">presupuestos importados correctamente</p>
                    {resultado.importados < resultado.total && (
                      <p className="text-xs text-amber-600 mt-1">
                        {resultado.total - resultado.importados} registros no pudieron importarse
                      </p>
                    )}
                  </div>
                  {resultado.errores.length > 0 && (
                    <div className="w-full max-w-sm rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      <p className="font-semibold mb-1">Errores:</p>
                      {resultado.errores.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
          {/* Back button */}
          <div>
            {paso > 1 && paso < 5 && (
              <button
                onClick={() => setPaso((paso - 1) as 1 | 2 | 3 | 4 | 5)}
                className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                ← Anterior
              </button>
            )}
          </div>

          {/* Forward / action buttons */}
          <div className="flex gap-2">
            {paso === 2 && (
              <button
                onClick={applyMappingAndContinue}
                disabled={!mappingValid}
                className="text-sm px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40"
              >
                Aplicar mapeo →
              </button>
            )}
            {paso === 3 && (
              <button
                onClick={() => { if (aImportar.length > 0) setPaso(4); }}
                disabled={aImportar.length === 0}
                className="text-sm px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40"
              >
                Continuar → ({aImportar.length})
              </button>
            )}
            {paso === 4 && (
              <button
                onClick={handleImportar}
                disabled={aImportar.length === 0}
                className="text-sm px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40"
              >
                Confirmar importación
              </button>
            )}
            {paso === 5 && !importing && resultado && (
              <button
                onClick={() => { onImported(); onClose(); }}
                className="text-sm px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700"
              >
                Ver en Panel →
              </button>
            )}
            {paso === 5 && !importing && !resultado && (
              <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
