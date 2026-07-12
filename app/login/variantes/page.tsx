import type { Metadata } from "next";
import { VariantesDemo } from "./VariantesDemo";

// Demo visual del rediseño de login (elección de variante). Sin lógica:
// no llama a ningún API ni toca sesión/aislamiento. Se retira al decidir.
export const metadata: Metadata = {
  title: "Fyllio — login: variantes (demo visual)",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <VariantesDemo />;
}
