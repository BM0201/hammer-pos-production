import type { MetadataRoute } from "next";

// Instalable como app: en la tablet de caja abre a pantalla completa, sin barra de Chrome ni pestañas.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "H.A.M.M.E.R. — POS / ERP",
    short_name: "Hammer",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    background_color: "#EDECEA",
    theme_color: "#EDECEA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
