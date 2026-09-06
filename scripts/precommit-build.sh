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
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
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
if (cd "$tmp" && npx tsc --noEmit >"$log" 2>&1 && npx next build >>"$log" 2>&1); then
  limpiar
  exit 0
fi
motivo=$(grep -m3 -E "error TS|Module not found|Failed to compile|Error:" "$log" | head -c 700)
limpiar
python3 - "$motivo" <<'EOF'
import json, sys
motivo = sys.argv[1].strip() or "ver la salida de `npm run build`"
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "[build] tsc + next build tienen que pasar antes de commitear (be26b8e rompió Vercel con tsc limpio). Fallo: " + motivo,
  }
}, ensure_ascii=False))
EOF
