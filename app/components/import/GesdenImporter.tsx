"use client";

import { useRef, useState } from "react";
import { parseCSV, detectPatientColumns } from "../../lib/integrations/gesden/columnMap";

type ImportResult = {
  ok: boolean;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  preview: Array<{ nombre: string; telefono: string; nhc: string }>;
  detectedColumns: Record<string, string | null>;
};

type Stage = "idle" | "preview" | "importing" | "done" | "error";

const COL_LABELS: Record<string, string> = {
  primerApellido: "Primer apellido",
  segundoApellido: "Segundo apellido",
  nombre: "Nombre",
  telefono: "Teléfono móvil",
  telefonoFijo: "Teléfono fijo",
  email: "Email",
  fechaNacimiento: "Fecha nacimiento",
  nhc: "NHC",
  sexo: "Sexo",
  direccion: "Dirección",
  codigoPostal: "Código postal",
  poblacion: "Población",
};

export default function GesdenImporter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState("");
  const [rowCount, setRowCount] = useState(0);
  const [colMap, setColMap] = useState<Record<string, number>>({});
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Array<{ nombre: string; telefono: string; nhc: string }>>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function handleFileChange(f: File | null) {
    if (!f) return;
    setFile(f);
    setFileName(f.name);
    setResult(null);
    setErrorMsg("");

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const { headers: h, rows } = parseCSV(text);
        if (!h.length) {
          setErrorMsg("No se pudieron detectar columnas en el archivo. ¿Es un CSV válido?");
          setStage("error");
          return;
        }
        const map = detectPatientColumns(h);
        setHeaders(h);
        setColMap(map);
        setRowCount(rows.length);

        // Quick preview (first 5 rows)
        const prev = rows.slice(0, 5).map((row) => {
          const vals = Object.values(row);
          function get(key: keyof typeof map): string {
            const idx = (map as Record<string, number>)[key];
            return idx >= 0 ? (vals[idx] ?? "").trim() : "";
          }
          const nombre = [get("primerApellido"), get("segundoApellido"), get("nombre")]
            .filter(Boolean)
            .join(" ");
          const telefono = get("telefono") || get("telefonoFijo") || "—";
          const nhc = get("nhc") || "—";
          return { nombre: nombre || "—", telefono, nhc };
        });
        setPreviewRows(prev);
        setStage("preview");
      } catch {
        setErrorMsg("Error al leer el archivo.");
        setStage("error");
      }
    };
    reader.readAsText(f, "utf-8");
  }

  async function handleImport() {
    if (!file) return;
    setStage("importing");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/gesden", { method: "POST", body: formData });
      const json: ImportResult = await res.json();
      if (!res.ok) {
        setErrorMsg((json as any).error ?? "Error al importar.");
        setStage("error");
        return;
      }
      setResult(json);
      setStage("done");
    } catch {
      setErrorMsg("Error de conexión al importar.");
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setFile(null);
    setFileName("");
    setResult(null);
    setErrorMsg("");
    setColMap({});
    setHeaders([]);
    setPreviewRows([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const detectedCount = Object.values(colMap).filter((v) => v >= 0).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-700 to-slate-900 p-6 text-white">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Importación de datos
        </p>
        <h2 className="mt-1 text-2xl font-extrabold">Gesden → Fyllio</h2>
        <p className="text-sm text-slate-300 mt-1">
          Importa pacientes desde un CSV exportado de Gesden. Los datos se añaden o actualizan en Airtable.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
            <p className="text-xs text-slate-400 font-medium">Fuente</p>
            <p className="text-sm font-bold mt-0.5">CSV Gesden</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
            <p className="text-xs text-slate-400 font-medium">Destino</p>
            <p className="text-sm font-bold mt-0.5">Airtable</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
            <p className="text-xs text-slate-400 font-medium">API Gesden</p>
            <p className="text-sm font-bold mt-0.5 text-amber-300">Pendiente</p>
          </div>
        </div>
      </div>

      {/* Step 1 — File upload */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
          <h3 className="text-sm font-bold text-slate-800">Seleccionar archivo CSV de Gesden</h3>
        </div>

        <div
          className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileChange(e.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          {fileName ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">📄 {fileName}</p>
              <p className="text-xs text-slate-500 mt-1">
                {rowCount} pacientes detectados · Haz clic para cambiar
              </p>
            </div>
          ) : (
            <div>
              <p className="text-2xl mb-2">📂</p>
              <p className="text-sm font-semibold text-slate-700">Arrastra aquí el CSV de Gesden</p>
              <p className="text-xs text-slate-500 mt-1">o haz clic para seleccionar</p>
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-600">¿Cómo exportar de Gesden?</p>
          <p>Ir a <b>Pacientes → Listado → Exportar</b> y seleccionar CSV con separador punto y coma (;).</p>
          <p>Asegúrate de incluir: Nombre, Apellidos, Teléfono móvil, NHC.</p>
        </div>
      </div>

      {/* Step 2 — Column mapping preview */}
      {stage !== "idle" && stage !== "error" && headers.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
            <h3 className="text-sm font-bold text-slate-800">Mapeo de columnas detectado</h3>
            <span className="ml-auto text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
              {detectedCount} de {Object.keys(COL_LABELS).length} campos detectados
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(COL_LABELS).map(([key, label]) => {
              const idx = (colMap as Record<string, number>)[key] ?? -1;
              const detected = idx >= 0;
              const colName = detected ? headers[idx] : null;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                    detected ? "bg-emerald-50 border border-emerald-100" : "bg-slate-50 border border-slate-100 opacity-50"
                  }`}
                >
                  <span>{detected ? "✅" : "—"}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">{label}</p>
                    {colName && (
                      <p className="text-slate-400 truncate">← "{colName}"</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview rows */}
          {previewRows.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Vista previa (primeras {previewRows.length} filas)
              </p>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-500 font-semibold">Nombre</th>
                      <th className="px-3 py-2 text-left text-slate-500 font-semibold">Teléfono</th>
                      <th className="px-3 py-2 text-left text-slate-500 font-semibold">NHC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-800">{row.nombre}</td>
                        <td className="px-3 py-2 text-slate-600">{row.telefono}</td>
                        <td className="px-3 py-2 text-slate-500">{row.nhc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Import */}
      {(stage === "preview" || stage === "importing") && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-6 w-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
            <h3 className="text-sm font-bold text-slate-800">Importar datos</h3>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-700 mb-4">
            <p className="font-semibold">⚠️ Antes de importar</p>
            <p className="mt-1">
              Se crearán <b>{rowCount} registros</b> en Airtable (pacientes nuevos) o se actualizarán los existentes por teléfono.
              Esta acción no se puede deshacer fácilmente.
            </p>
          </div>

          {stage === "importing" ? (
            <div className="text-center py-4">
              <div className="text-2xl mb-2">⏳</div>
              <p className="text-sm font-semibold text-slate-700">Importando {rowCount} pacientes...</p>
              <p className="text-xs text-slate-500 mt-1">Esto puede tardar unos segundos. No cierres la página.</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleImport}
              className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition"
            >
              ✅ Importar {rowCount} pacientes → Airtable
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {stage === "done" && result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <h3 className="text-base font-bold text-emerald-800">Importación completada</h3>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-white border border-emerald-100 p-3">
              <p className="text-xl font-extrabold text-emerald-700">{result.imported}</p>
              <p className="text-xs text-slate-500 mt-0.5">nuevos</p>
            </div>
            <div className="rounded-xl bg-white border border-emerald-100 p-3">
              <p className="text-xl font-extrabold text-slate-700">{result.updated}</p>
              <p className="text-xs text-slate-500 mt-0.5">actualizados</p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3">
              <p className="text-xl font-extrabold text-slate-500">{result.skipped}</p>
              <p className="text-xs text-slate-500 mt-0.5">omitidos</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-xl bg-white border border-amber-100 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700">{result.errors.length} errores</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">{e}</p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="text-xs px-4 py-2 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Importar otro archivo
          </button>
        </div>
      )}

      {/* Error */}
      {stage === "error" && errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg shrink-0">❌</span>
          <div>
            <p className="text-sm font-semibold text-red-700">Error</p>
            <p className="text-xs text-red-600 mt-0.5">{errorMsg}</p>
            <button
              type="button"
              onClick={reset}
              className="text-xs mt-2 px-3 py-1.5 rounded-full border border-red-200 text-red-600 hover:bg-red-100"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* API status footer */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 flex items-start gap-3">
        <span className="text-slate-400 text-lg shrink-0">⚙️</span>
        <div>
          <p className="text-sm font-semibold text-slate-700">Integración API Gesden</p>
          <p className="text-xs text-slate-500 mt-1">
            Cuando Gesden proporcione credenciales API, la sincronización será automática y diaria.
            Añade <code className="bg-slate-200 px-1 rounded">GESDEN_API_KEY</code>,{" "}
            <code className="bg-slate-200 px-1 rounded">GESDEN_API_URL</code> y{" "}
            <code className="bg-slate-200 px-1 rounded">GESDEN_CLINIC_ID</code> al entorno para activarla.
          </p>
        </div>
      </div>
    </div>
  );
}
