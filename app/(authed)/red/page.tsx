// F1 (fase F): /red se renombró a /inicio — «Red» presuponía varias clínicas
// y no siempre las hay; es la vista de entrada. Redirect permanente para
// marcadores guardados. (La API /api/red/dashboard CONSERVA su nombre a
// propósito: renombrar rutas de API no lo ve ninguna coordinadora.)
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RedRedirect() {
  redirect("/inicio");
}
