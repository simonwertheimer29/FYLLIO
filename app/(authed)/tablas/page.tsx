// F4b (fase F): /tablas es la base de datos consultable de la clínica — el
// sitio donde se audita. Sin vista propia: aterriza en la primera subpestaña.
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function TablasRedirect() {
  redirect("/tablas/leads");
}
