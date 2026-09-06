// app/lib/mensajeria/confirmar-envio-cliente.ts
//
// Lado cliente de MEJORAS 130. Tras abrir wa.me, la pestaña de Fyllio se queda
// con la pregunta «¿ya lo has enviado?»: un toast con acción, el mismo en los
// cuatro sitios que abren WhatsApp (composer, intervención, lead, cola de
// envíos). Si la persona no contesta, el saliente sigue PENDIENTE y el hilo
// lo enseña en gris con el mismo botón — no se pierde, no se da por enviado.

import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../fetch-json";

export async function confirmarEnvio(mensajeId: string): Promise<boolean> {
  try {
    await cargarJSON<{ ok: boolean }>("/api/mensajeria/confirmar-envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensajeId }),
    });
    return true;
  } catch (e) {
    toast.error(mensajeDeError(e));
    return false;
  }
}

export function preguntarSiSeEnvio(mensajeId: string | null | undefined, onConfirmado?: () => void): void {
  if (!mensajeId) {
    toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
    return;
  }
  toast("Se ha abierto WhatsApp con el mensaje. ¿Lo has enviado?", {
    duration: 120_000,
    action: {
      label: "Sí, enviado",
      onClick: () => {
        void confirmarEnvio(mensajeId).then((ok) => {
          if (ok) {
            toast.success("Envío confirmado");
            onConfirmado?.();
          }
        });
      },
    },
    description: "Hasta que lo confirmes, en el hilo aparece como pendiente.",
  });
}
