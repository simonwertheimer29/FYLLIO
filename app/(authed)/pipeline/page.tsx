// F4a (fase F): /pipeline agrupa los dos kanbans del trabajo vivo. Sin
// vista propia: aterriza en la primera subpestaña.
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function PipelineRedirect() {
  redirect("/pipeline/leads");
}
