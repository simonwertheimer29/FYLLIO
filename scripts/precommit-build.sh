#!/usr/bin/env bash
# Hook PreToolUse (Bash) de Claude Code — antes de un `git commit`, tsc + next build.
#
# Por qué: un `tsc --noEmit` limpio NO prueba que el build pase. La frontera
# cliente/servidor —un Client Component que importa como valor algo que
# arrastra `pg`— solo la ve `next build`. El 06-09-2026 el commit be26b8e pasó
# tsc y rompió el build de Vercel. El build tarda ~17 s; un deploy roto, una
# mañana. Se configura en .claude/settings.json (proyecto, versionado).
#
# Valida LO QUE SE COMMITEA, no el árbol de trabajo: exporta el índice (git
# write-tree + git archive) a un directorio temporal y construye ahí. Así el
# trabajo en curso de otra sesión —ficheros sin añadir con un error de tipos
# transitorio— no bloquea un commit ajeno (pasó el 06-09 a los diez minutos de
# estrenar el hook), y el `.next` del proyecto no se toca: un `next start`
# sirviendo desde ahí no ve chunks a medias (lección del servidor de 31 días).
# node_modules y .env.local se enlazan desde el proyecto; nada se copia.
set -u
input=$(cat)
denegar() {
  python3 - "$1" <<'EOF'
import json, sys
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": sys.argv[1],
  }
}, ensure_ascii=False))
EOF
  exit 0
}
# Sin jq el hook no podría leer el comando y pasaría TODO en silencio: eso es
# peor que no tener hook. Se dice y se deniega.
command -v jq >/dev/null 2>&1 || denegar "[build] el hook de pre-commit necesita jq y no está instalado (brew install jq); sin él no puede validar y no deja commitear a ciegas."
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
# Lo entrecomillado no es un comando: un mensaje de commit que hable de «git
# add», un echo que diga «git commit»… se quita ANTES de mirar (el 08-09 el
# hook denegó un commit por el texto de su propio mensaje).
# (Sin heredoc dentro de $(): el bash 3.2 de macOS se pierde con las comillas
# del cuerpo y el hook entero deja de parsear — pasó el 08-09.)
sin=$(python3 -c "import re,sys; print(re.sub(r'\"(?:[^\"\\\\]|\\\\.)*\"|\x27[^\x27]*\x27', ' ', sys.argv[1], flags=re.S))" "$cmd" 2>/dev/null || printf '%s' "$cmd")
case "$sin" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
# EL AGUJERO DEL 07-09 (a583fb1): este hook valida EL ÍNDICE en el momento de
# la llamada. Si el mismo comando hace `git add … && git commit …` (o `commit
# -a`), el índice que se construye es el de HEAD —limpio— y lo que se commitea
# después es otra cosa. El build pasó en local y reventó en Vercel. Por eso:
# añadir y commitear van en comandos SEPARADOS, y aquí se deniega la mezcla.
case "$sin" in
  *"git add"*) denegar "[build] no mezcles 'git add' y 'git commit' en el mismo comando: el hook valida el índice ANTES de ejecutar, así que construiría HEAD y no lo que vas a commitear (a583fb1 rompió Vercel así). Haz 'git add …' en un comando y 'git commit …' en otro." ;;
esac
if printf '%s' "$sin" | grep -Eq 'git commit[^|;&]*(\s-a(\s|$)|\s-am\s|\s--all(\s|$))'; then
  denegar "[build] 'git commit -a' añade al commitear y el hook no puede validarlo (valida el índice antes). Haz 'git add …' en un comando aparte y luego 'git commit …' sin -a."
fi
cwd=$(printf '%s' "$input" | jq -r '.cwd // "."' 2>/dev/null)
cd "$cwd" 2>/dev/null || exit 0
# Solo en un proyecto Next con este script de build; en otro repo, callar.
{ [ -f package.json ] && grep -q '"build": "next build"' package.json; } || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# El export vive DENTRO del proyecto (.precommit-build/, en .gitignore) y sin
# package-lock.json: Turbopack toma como raíz el directorio del lockfile más
# cercano hacia arriba —el proyecto— y así el enlace a node_modules queda
# dentro de su raíz. Fuera del proyecto revienta: «Symlink node_modules is
# invalid, it points out of the filesystem root».
# Directorio ÚNICO por ejecución: dos sesiones commiteando a la vez
# compartían .precommit-build/ y una borraba el build de la otra a medias
# (ENOENT en pages-manifest.json, 06-09).
tmp=$(mktemp -d "$PWD/.precommit-build.XXXXXX") || exit 0
log="$tmp.log"
limpiar() { rm -rf "$tmp" "$log"; }
tree=$(git write-tree 2>/dev/null) || { limpiar; exit 0; }
if ! git archive --format=tar "$tree" | tar -x -C "$tmp"; then limpiar; exit 0; fi
rm -f "$tmp/package-lock.json"
ln -s ../node_modules "$tmp/node_modules"
[ -f .env.local ] && ln -s ../.env.local "$tmp/.env.local"
# Orden: la frontera cliente/servidor (1 s, la causa de be26b8e y a583fb1),
# tsc, y por último el build entero.
if (cd "$tmp" && npx tsx scripts/qa-frontera-cliente.mts >"$log" 2>&1 && npx tsc --noEmit >>"$log" 2>&1 && npx next build >>"$log" 2>&1); then
  limpiar
  exit 0
fi
motivo=$(grep -m4 -E "frontera cliente/servidor|⇒|error TS|Module not found|Failed to compile|Error:" "$log" | head -c 900)
limpiar
denegar "[build] frontera + tsc + next build tienen que pasar antes de commitear (be26b8e y a583fb1 rompieron Vercel). Fallo: ${motivo:-ver la salida de npm run build}"
