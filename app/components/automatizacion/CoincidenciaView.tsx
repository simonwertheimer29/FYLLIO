"use client";

// Coincidencia agente-humano — /automatizaciones → pestaña «¿Escribe bien?»
//
// ─── Qué responde y por qué vive aquí ───────────────────────────────────────
//
// Responde a: de los mensajes que preparó el asistente, ¿cuántos salieron tal
// cual? Es el criterio objetivo que decide cuándo el agente puede pasar a
// enviar solo — sin él, subir de modo es una corazonada.
//
// Vive en /automatizaciones y no en /kpis a propósito: /kpis mide el NEGOCIO de
// la clínica (dinero, aceptación, no-shows) y esto mide la HERRAMIENTA. Meterlo
// ahí diluiría la pantalla que la gerencia usa para decidir sobre su clínica, y
// además la decisión que este número dispara —subir la autonomía— se toma aquí.
//
// ─── La regla que gobierna la pantalla ──────────────────────────────────────
//
// El denominador siempre a la vista, como en el resto del producto. Y un
// conjunto vacío NO se pinta como 0 %: «todavía no hay nada medido» y «el agente
// no acierta nunca» son la misma cifra y significados opuestos.

import { useCallback, useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { ErrorState } from "../ui/Feedback";
import { CardListSkeleton } from "../ui/Skeleton";
import { cargarJSON } from "../../lib/fetch-json";
import { Info, Sparkles } from "../icons";
import {
  ETIQUETA_COINCIDENCIA,
  UMBRAL_EDITADO,
  type ResumenCoincidencia,
} from "../../lib/automatizacion/coincidencia";

type Fila = ResumenCoincidencia & { clave: string };
type Semana = ResumenCoincidencia & { semana: string };
type Datos = {
  dias: number;
  total: ResumenCoincidencia;
  sinSugerido: number;
  porIntencion: Fila[];
  porTipo: Fila[];
  evolucion: Semana[];
};

const DOMINIO: Record<string, string> = {
  presupuesto: "Presupuestos",
  lead: "Leads",
  cobro: "Cobros",
};

/** Barra de reparto: tal cual · editado · reescrito, en una sola línea. */
function Reparto({ r, alto = "h-2.5" }: { r: ResumenCoincidencia; alto?: string }) {
  if (r.total === 0) return null;
  const pct = (n: number) => (n / r.total) * 100;
  return (
    <div className={`flex w-full overflow-hidden rounded-full ${alto}`} role="img"
      aria-label={`${r.talCual} tal cual, ${r.editado} editados, ${r.reescrito} reescritos de ${r.total}`}>
      <div className="bg-[var(--color-success)]" style={{ width: `${pct(r.talCual)}%` }} />
      <div className="bg-[var(--color-warning)]" style={{ width: `${pct(r.editado)}%` }} />
      <div className="bg-[var(--color-danger)]" style={{ width: `${pct(r.reescrito)}%` }} />
    </div>
  );
}

/** Fila de tabla con su denominador SIEMPRE escrito: «14 de 20». */
function FilaTasa({ nombre, r }: { nombre: string; r: ResumenCoincidencia }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--color-foreground)]">{nombre}</p>
        <div className="mt-1.5 max-w-xs">
          <Reparto r={r} alto="h-1.5" />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
          {r.tasaTalCual}%
        </p>
        <p className="text-[11px] tabular-nums text-[var(--color-muted)]">
          {r.talCual} de {r.total}
        </p>
      </div>
    </div>
  );
}

export function CoincidenciaView() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // cargarJSON, no fetch a pelo: un 401 o un 500 tienen que LANZAR, no
      // convertirse en una pantalla con ceros (§10).
      const d = await cargarJSON<Datos>("/api/automatizacion/coincidencia?dias=90");
      setDatos(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando && !datos) return <CardListSkeleton rows={3} />;
  if (error) {
    return (
      <ErrorState
        title="No se pudo cargar la coincidencia"
        detail={error}
        onRetry={() => void cargar()}
      />
    );
  }
  if (!datos) return null;

  const { total, sinSugerido, porIntencion, porTipo, evolucion, dias } = datos;
  const hayDatos = total.total > 0;

  return (
    <div className="space-y-4">
      {/* ── Titular ── */}
      <Card>
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
              Mensajes que preparó el asistente · últimos {dias} días
            </p>

            {hayDatos ? (
              <>
                <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">
                  {total.tasaTalCual}%{" "}
                  <span className="text-base font-normal text-[var(--color-muted)]">
                    salieron tal cual
                  </span>
                </p>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {total.talCual} de {total.total} enviados sin tocar una coma.
                </p>
                <div className="mt-3 max-w-md">
                  <Reparto r={total} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
                      <i className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
                      {ETIQUETA_COINCIDENCIA.tal_cual} · {total.talCual}
                    </span>
                    <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
                      <i className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />
                      {ETIQUETA_COINCIDENCIA.editado} · {total.editado}
                    </span>
                    <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
                      <i className="h-2 w-2 rounded-full bg-[var(--color-danger)]" />
                      {ETIQUETA_COINCIDENCIA.reescrito} · {total.reescrito}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              /* Vacío HONESTO. Un 0 % aquí diría «el asistente no acierta
                 nunca», que es lo contrario de lo que pasa: es que todavía no
                 se ha medido ningún envío. */
              <>
                <p className="mt-1 font-display text-xl font-semibold text-[var(--color-foreground)]">
                  Todavía no hay ningún envío medido
                </p>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
                  La medición empezó el 5 de agosto de 2026 y solo cuenta los mensajes que el
                  asistente había preparado. En cuanto se envíe el primero desde la ficha de un
                  paciente, aparecerá aquí. <strong>No es un 0 %</strong>: es que no hay nada que
                  medir todavía.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── El denominador entero, que es la regla del producto ── */}
      {sinSugerido > 0 && (
        <div className="flex gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)]" aria-hidden />
          <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">
            Otros <strong className="text-[var(--color-foreground)]">{sinSugerido}</strong> mensajes
            salieron sin que el asistente hubiera preparado nada, así que no cuentan en la tasa:
            no se puede medir si acierta cuando no propuso. Aparecen aquí para que el denominador
            se vea entero.
          </p>
        </div>
      )}

      {hayDatos && (
        <>
          {/* ── Por intención — es lo que decide la matriz de la fase 4 ── */}
          <Card>
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              Por lo que preguntaba el paciente
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
              Es el corte que importa: una media alta puede esconder que el asistente acierta en
              los recordatorios y falla en todo lo que roza el precio, y son decisiones opuestas.
            </p>
            <div className="mt-2 divide-y divide-[var(--color-border)]">
              {porIntencion.map((f) => (
                <FilaTasa key={f.clave} nombre={f.clave} r={f} />
              ))}
            </div>
          </Card>

          {/* ── Evolución ── */}
          {evolucion.length > 1 && (
            <Card>
              <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
                Semana a semana
              </h2>
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">
                Si sube, el asistente está aprendiendo del uso. Si baja después de tocar el prompt,
                el cambio empeoró algo.
              </p>
              <div className="mt-3 space-y-2">
                {evolucion.map((s) => (
                  <div key={s.semana} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
                      {new Date(s.semana + "T00:00:00").toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Reparto r={s} alto="h-2" />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]">
                      {s.tasaTalCual}% · {s.total}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Por dominio ── */}
          {porTipo.length > 1 && (
            <Card>
              <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
                Por dónde
              </h2>
              <div className="mt-2 divide-y divide-[var(--color-border)]">
                {porTipo.map((f) => (
                  <FilaTasa key={f.clave} nombre={DOMINIO[f.clave] ?? f.clave} r={f} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Cómo se mide, dicho en voz de coordinadora ── */}
      <Card>
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Cómo se cuenta
        </h2>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-[var(--color-muted)]">
          <li>
            <strong className="text-[var(--color-foreground)]">Tal cual</strong> — se envió sin
            cambiar nada. Cambiar una tilde, una mayúscula o un espacio de más sigue contando como
            tal cual: eso no es una decisión, es el teclado.
          </li>
          <li>
            <strong className="text-[var(--color-foreground)]">Editado</strong> — se cambió menos
            de un {Math.round(UMBRAL_EDITADO * 100)} % del texto: el fondo servía y se ajustó la
            forma.
          </li>
          <li>
            <strong className="text-[var(--color-foreground)]">Reescrito</strong> — se cambió más:
            la propuesta no servía para este caso.
          </li>
          <li>
            Los mensajes escritos de cero, sin que el asistente propusiera nada,{" "}
            <strong className="text-[var(--color-foreground)]">no cuentan</strong> en la tasa.
          </li>
        </ul>
      </Card>
    </div>
  );
}
