// app/lib/plantillas/llaves.ts
//
// Sustitución de llaves DOBLES — PURA y CLIENT-SAFE (21-08: vivía en
// plantillas.ts, que importa repos de servidor, y los componentes cliente
// que rellenan plantillas no podían usarla — por eso el SidePanel seguía
// sustituyendo llave simple, el bug de B6.2 con otra cara).
//
// Contrato duro (B6.2, 18-08): cada caller declara SUS valores (§16 —
// {{importe}} no significa lo mismo en cobros que en la cadencia), y NINGUNA
// llave sobrevive en un texto que se dé por bueno — ni una doble sin dato,
// ni una SIMPLE de una plantilla mal escrita («Hola {Ana}» ya casi le llega
// a un paciente). Si `sinResolver` no está vacío, el texto NO se envía: se
// descarta y se cuenta (o se avisa, en UI).

export function sustituirLlaves(
  contenido: string,
  valores: Record<string, string>,
): { texto: string; sinResolver: string[] } {
  const sinResolver: string[] = [];
  const texto = contenido.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (todo, clave: string) => {
    const v = valores[clave];
    if (v == null || v === "") {
      sinResolver.push(clave);
      return todo;
    }
    return v;
  });
  for (const m of texto.matchAll(/\{+\s*([a-zA-Z_]+)\s*\}+/g)) {
    if (!sinResolver.includes(m[1]!)) sinResolver.push(m[1]!);
  }
  return { texto, sinResolver };
}
