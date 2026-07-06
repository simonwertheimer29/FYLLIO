import type { MetadataRoute } from "next";

// Sprint UI — manifest PWA real: la coordinadora puede instalar Fyllio
// como app en el móvil. Solo config + assets estáticos.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fyllio",
    short_name: "Fyllio",
    description: "El asistente que ordena el día de tu clínica.",
    // Arranca en la pantalla de trabajo; si no hay sesión, el proxy
    // redirige a /login como en cualquier visita normal.
    start_url: "/actuar-hoy",
    display: "standalone",
    background_color: "#fafbfc",
    theme_color: "#3d6fb2",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
