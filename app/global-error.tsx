"use client";

// Último recurso: un fallo en el propio layout raíz, donde ninguna otra
// frontera llega. Reemplaza el documento entero, así que monta su propio
// <html>/<body> y no puede apoyarse en los providers de la app.
//
// Estilos en línea a propósito: si lo que ha fallado es el layout raíz, dar por
// hecho que el CSS de la app está cargado es dar por hecho justo lo que acaba
// de romperse.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", {
      mensaje: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    });
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafbfc",
          color: "#0e1116",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
            Fyllio no ha podido arrancar
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#5b6472", marginTop: "0.5rem" }}>
            Ha fallado algo antes de poder pintar la aplicación. Tus datos están
            intactos. Vuelve a intentarlo; si sigue igual, avísanos.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.375rem 0.75rem",
              borderRadius: "6px",
              border: "none",
              background: "#3D6FB2",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
