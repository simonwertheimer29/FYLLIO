"use client";

// El compositor de la bandeja, con su capa de acción encima.
//
// ─── Por qué no hay una vía de envío nueva ─────────────────────────────────
//
// Envía por las MISMAS rutas que el panel de Seguimiento
// (`/api/presupuestos/intervencion/enviar-*` y `/api/leads/intervencion/enviar-*`).
// Podría haber una ruta propia de la bandeja, y sería más cómoda; sería también
// una segunda vía por la que la autoría, el quiebre y la coincidencia se
// registrarían distinto. Ese es el patrón paralelo que llevamos dos meses
// matando: la bandeja y Seguimiento tienen que ser la misma fuente leída de dos
// formas, y eso empieza por escribir por el mismo sitio.
//
// ─── Lo que sí es distinto de un WhatsApp Web ──────────────────────────────
//
// Si el caso está quebrado, el compositor NO trae borrador y lo dice. El texto
// es el mismo que el del panel de Seguimiento, palabra por palabra, porque es
// la misma decisión: un borrador esperando para una pregunta de dinero es una
// invitación a mandarlo, y si hace falta una persona es precisamente porque hay
// que pensar qué se dice.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Composer } from "../../components/shared/panel-accion-ui";
import { AlertTriangle } from "../../components/icons";
import { mensajeDeError } from "../../lib/fetch-json";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";

export function ComposerBandeja({
  conversacion,
  onEnviado,
}: {
  conversacion: Conversacion;
  onEnviado: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Igual que en los paneles: si el texto viene del agente y se manda tal cual,
  // el autor del texto es él. Se desmarca en cuanto una persona lo reescribe.
  const [textoDeIA, setTextoDeIA] = useState(false);

  // ─── El fallo que tenía esta pantalla, y por qué importaba ────────────
  //
  // La primera versión enviaba SIEMPRE por `enviar-manual` y decía «Mensaje
  // enviado». Pero el modo manual —que es el único que hay hoy— no envía nada:
  // registra el saliente y devuelve una URL de wa.me para que la persona
  // termine el envío allí. El panel de Seguimiento la abre; esta no lo hacía.
  //
  // O sea: desde la bandeja se pulsaba Enviar, el mensaje aparecía en el hilo,
  // salía «Mensaje enviado»… y el paciente no recibía nada. Es el §1 exacto —
  // confirmar un éxito que no ocurrió— con el agravante de que el hilo, que es
  // el registro de lo que se le ha dicho a esa persona, quedaba mintiendo.
  //
  // Ahora hace lo mismo que el panel: elige la vía según si WABA está activo en
  // esa clínica, y en manual abre wa.me en vez de dar por hecho el envío.
  const [wabaActivo, setWabaActivo] = useState<boolean | null>(null);

  const clinicaNombre = conversacion.clinicaNombre;
  useEffect(() => {
    let cancelado = false;
    const qs = clinicaNombre ? `?clinica=${encodeURIComponent(clinicaNombre)}` : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelado) return;
        setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true);
      })
      // Ante la duda, manual: abrir wa.me de más es un incordio; dar por
      // enviado un mensaje que no salió, no.
      .catch(() => !cancelado && setWabaActivo(false));
    return () => {
      cancelado = true;
    };
  }, [clinicaNombre]);

  // Sin caso no hay ruta de envío: las que existen escriben contra un
  // presupuesto o un lead. Se dice en vez de enseñar un campo que no funciona.
  const sinCaso = !conversacion.presupuestoId && !conversacion.leadId;

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const via = wabaActivo ? "enviar-waba" : "enviar-manual";
      const ruta = conversacion.presupuestoId
        ? `/api/presupuestos/intervencion/${via}`
        : `/api/leads/intervencion/${via}`;
      const cuerpo = conversacion.presupuestoId
        ? { presupuestoId: conversacion.presupuestoId }
        : { leadId: conversacion.leadId };

      const res = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cuerpo,
          telefono: conversacion.telefono,
          contenido,
          sugeridoPorIa: textoDeIA,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `El servidor respondió ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));

      setTexto("");
      setTextoDeIA(false);

      if (data?.urlWhatsApp) {
        // Modo manual: el mensaje está REGISTRADO, no enviado. Se abre WhatsApp
        // para que lo mande de verdad una persona, y el aviso lo dice tal cual
        // en vez de «enviado», que sería falso hasta que le dé a enviar allí.
        window.open(data.urlWhatsApp, "_blank");
        toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
      } else {
        toast.success("Mensaje enviado");
      }
      onEnviado();
    } catch (e) {
      // No se limpia el campo: lo escrito no se pierde por un fallo de red.
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      {conversacion.necesitaPersona && !texto.trim() && (
        <div className="mx-3 mt-2 mb-2 flex gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3.5 py-2.5">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
            aria-hidden
          />
          <div className="min-w-0 text-[13px] leading-relaxed text-[var(--color-foreground)]">
            <p className="font-medium">Esto necesita tu criterio</p>
            <p className="mt-0.5 text-[var(--color-muted)]">
              No he preparado ningún borrador a propósito: lo que se conteste aquí lo
              sostiene la clínica.
            </p>
          </div>
        </div>
      )}

      {sinCaso && (
        <div className="mx-3 mt-2 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3.5 py-2.5">
          <p className="text-[13px] font-medium text-[var(--color-foreground)]">
            Todavía no sabemos quién es
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-muted)]">
            Esta conversación no está asociada a ningún paciente ni lead, así que
            desde aquí no se puede responder. Créale una ficha y vuelve.
          </p>
        </div>
      )}

      <Composer
        value={texto}
        onChange={(v) => {
          setTexto(v);
          setError(null);
          setTextoDeIA(false);
        }}
        onEnviar={enviar}
        enviando={enviando}
        // Sin plantillas en esta primera versión, a propósito: el catálogo se
        // eligió por CATEGORÍA en la fusión del 10 de agosto y aquí no siempre
        // hay caso del que deducirla. Enseñar todas sin filtrar sería peor que
        // no enseñarlas — el composer las acepta el día que se decida cuál toca.
        plantillas={[]}
        onPlantilla={() => {}}
        disabled={sinCaso || wabaActivo === null}
        disabledTitle={
          sinCaso ? "Sin paciente ni lead asociado" : "Comprobando cómo enviar…"
        }
        modoManual={wabaActivo === false}
        error={error}
      />
    </div>
  );
}
