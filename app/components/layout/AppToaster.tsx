"use client";

// Sprint UI — Toaster global de sonner sincronizado con el tema de la app
// (atributo data-theme en <html>, que gestiona ThemeToggle).

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function AppToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      richColors
      closeButton
      duration={3000}
    />
  );
}
