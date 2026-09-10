"use client";
// app/(authed)/ajustes/incidencias/IncidenciasView.tsx
//
// Un fallo sistemático de una clínica tiene que verse sin que nadie mire un
// log (MEJORAS 207). Arriba, lo que arde AHORA (≥ umbral de casos distintos en
// la última hora); debajo, todo lo de las últimas 24 h o 7 días agrupado por
// clínica, tipo y motivo. Sin contenido: motivo, tipo y referencia. El
// teléfono de las últimas referencias se resuelve al leer, bajo RLS, para
// poder abrir el hilo — no vive en la tabla.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState } from "../../../components/ui/Feedback";
import { AlertTriangle, RefreshCw, CheckCircle2, ICON_STROKE } from "../../../components/icons";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import { deDiccionario } from "../../../lib/diccionario";

type Grupo = {
  clinicaId: string | null;
  tipo: string;
  motivo: string;
  origen: string;
  veces: number;
  referencias: number;
  refsUltimaHora: number;
  primeraVez: string;
  ultimaVez: string;
  reintentable: boolean;
  detalle: Record<string, string | number | boolean | null> | null;
  ultimas: { referencia: string; telefono: string | null }[];
};

type Respuesta = {
  grupos: Grupo[];
  horas: number;
  plazoDias: number;
  umbral: number;
  cola: { activa: true } | { activa: false; motivo: string };
  generadoEn: string;
};

const TIPO: Readonly<Record<string, string>> = {
  agente: "Agente",
  cola: "Cola de trabajos",
  envio: "Envío",
  cron: "Tarea programada",
  integracion: "Integración",
  entrada: "Entrada de mensajes",
  sistema: "Sistema",
};

const MOTIVO: Readonly<Record<string, string>> = {
  modelo_no_disponible: "El modelo no responde (el turno se derivó)",
  configuracion_ilegible: "La configuración de la clínica no se puede leer",
  contexto_no_disponible: "No pudo cargar el caso",
  error_inesperado: "Error inesperado",
  tope_turnos: "Superó el tope de turnos en 24 h",
  reintentos_agotados: "Reintentos agotados: el turno no se evaluó",
  turno_error: "El turno falló y se reintenta",
  publicar_fallo: "No se pudo encolar el turno (corrió en el webhook)",
  tope_incidencias: "Tope de incidencias por hora alcanzado",
};

const COLA_INACTIVA: Readonly<Record<string, string>> = {
  sin_token: "sin QSTASH_TOKEN",
  sin_firma: "sin clave de firma",
  sin_url_publica: "sin URL pública",
};

function hace(iso: string, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function IncidenciasView() {
  const [horas, setHoras] = useState<24 | 168>(24);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await cargarJSON<Respuesta>(`/api/admin/incidencias?horas=${horas}`, {
        validar: (d) => Array.isArray((d as Respuesta)?.grupos),
      });
      setDatos(r);
    } catch (e) {
      // Se conserva lo último bueno y se dice el error (§10).
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [horas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ahora = Date.now();
  const grupos = datos?.grupos ?? [];
  const umbral = datos?.umbral ?? 3;
  const ardiendo = grupos.filter((g) => g.refsUltimaHora >= umbral);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-geist-sans)] text-xl font-semibold text-[var(--color-foreground)]">Incidencias</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]" title="Sin contenido de conversación: solo motivo, tipo y referencia.">
            Los fallos que Fyllio capturó, por clínica, tipo y motivo{datos ? ` · caducan a los ${datos.plazoDias} días` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-sm">
            {([24, 168] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHoras(h)}
                className={`rounded-md px-3 py-1 ${horas === h ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"}`}
              >
                {h === 24 ? "24 h" : "7 días"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
          >
            <RefreshCw size={14} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </header>

      {error && (
        <ErrorState title="No se pudieron cargar las incidencias" detail={error} onRetry={() => void cargar()} />
      )}

      {datos && !datos.cola.activa && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-muted)]">
          La cola de trabajos está inactiva ({deDiccionario(COLA_INACTIVA, datos.cola.motivo, datos.cola.motivo, "incidencias.cola")}
          ): los turnos del agente corren en el webhook, sin reintento automático; el barrido los recupera.
        </p>
      )}

      {datos && ardiendo.length > 0 && (
        <section className="rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4">
          <h2 className="flex items-center gap-2 font-[family-name:var(--font-geist-sans)] text-base font-semibold text-[var(--color-danger)]">
            <AlertTriangle size={18} strokeWidth={ICON_STROKE} />
            Fallo sistemático ahora
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-foreground)]">
            {ardiendo.map((g) => (
              <li key={`${g.clinicaId}-${g.tipo}-${g.motivo}`}>
                <span className="font-medium">{g.clinicaId ?? "Toda la red"}</span> · {deDiccionario(TIPO, g.tipo, g.tipo, "incidencias.tipo")}:{" "}
                {deDiccionario(MOTIVO, g.motivo, g.motivo, "incidencias.motivo")} — {g.refsUltimaHora} casos distintos en la última hora
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos && grupos.length === 0 && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
          <CheckCircle2 size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" />
          Sin incidencias en {horas === 24 ? "las últimas 24 horas" : "los últimos 7 días"}.
        </div>
      )}

      {grupos.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 font-medium">Clínica</th>
                <th className="px-3 py-2 font-medium">Qué falla</th>
                <th className="px-3 py-2 font-medium text-right">Veces</th>
                <th className="px-3 py-2 font-medium text-right">Casos</th>
                <th className="px-3 py-2 font-medium">Última vez</th>
                <th className="px-3 py-2 font-medium">Detalle técnico</th>
                <th className="px-3 py-2 font-medium">Últimos casos</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const arde = g.refsUltimaHora >= umbral;
                return (
                  <tr key={`${g.clinicaId}-${g.tipo}-${g.motivo}`} className="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--color-foreground)]">{g.clinicaId ?? "Toda la red"}</td>
                    <td className="px-3 py-2">
                      <div className="text-[var(--color-foreground)]">
                        {deDiccionario(MOTIVO, g.motivo, g.motivo, "incidencias.motivo")}
                      </div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {deDiccionario(TIPO, g.tipo, g.tipo, "incidencias.tipo")} · {g.origen}
                        {g.reintentable ? " · se reintenta" : ""}
                        {arde ? <span className="ml-1 text-[var(--color-danger)]">· sistemático ahora</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-foreground)]">{g.veces}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-foreground)]">{g.referencias}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]" title={g.ultimaVez}>
                      {hace(g.ultimaVez, ahora)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                      {g.detalle
                        ? Object.entries(g.detalle)
                            .filter(([, v]) => v !== null && v !== "")
                            .slice(0, 5)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {g.ultimas.length === 0
                        ? <span className="text-[var(--color-muted)]">—</span>
                        : g.ultimas.map((u) =>
                            u.telefono ? (
                              <Link
                                key={u.referencia}
                                href={`/mensajeria?telefono=${encodeURIComponent(u.telefono)}`}
                                className="mr-2 text-[var(--color-accent)] hover:underline"
                              >
                                abrir hilo
                              </Link>
                            ) : (
                              <span key={u.referencia} className="mr-2 font-mono text-[var(--color-muted)]" title={u.referencia}>
                                {u.referencia.slice(0, 12)}…
                              </span>
                            ),
                          )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        No están aquí los fallos que mueren antes de nuestro código ni los del navegador: siguen en el registro de la plataforma.
      </p>
    </div>
  );
}
