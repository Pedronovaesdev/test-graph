#!/usr/bin/env bash
# install-hook.sh: instala o pre-push.sh como hook de pre-push do repositorio atual.
#
#   install-hook.sh [--project DIR] [--lang LANG] [--graphify PATH] [--force]
#   install-hook.sh --uninstall
#
# Rode de dentro do repositorio a proteger. Respeita core.hooksPath. Um
# pre-push que nao foi gerado aqui nao e sobrescrito sem --force (com --force,
# o antigo fica em pre-push.bak). As opcoes viram valores padrao no hook;
# as variaveis TGS_* do pre-push.sh continuam valendo por cima delas.

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" == /* ]] || SOURCE="$DIR/$SOURCE"
done
BIN_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
MARKER="# test-graph-selector: pre-push"

log() { printf '[install-hook] %s\n' "$*" >&2; }
die() { log "erro: $*"; exit 2; }
usage() { sed -n '4,5p' "$SOURCE" | sed 's/^# \{0,1\}//'; }

PROJECT=""
LANG_NAME=""
GRAPHIFY_PATH=""
FORCE=0
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:?--project precisa de valor}"; shift 2 ;;
    --lang) LANG_NAME="${2:?--lang precisa de valor}"; shift 2 ;;
    --graphify) GRAPHIFY_PATH="${2:?--graphify precisa de valor}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "argumento desconhecido: $1" ;;
  esac
done

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "rode dentro de um repositorio git"
HOOKS_DIR="$(git config core.hooksPath || true)"
if [[ -z "$HOOKS_DIR" ]]; then
  HOOKS_DIR="$(git rev-parse --git-path hooks)"
elif [[ "$HOOKS_DIR" != /* ]]; then
  HOOKS_DIR="$REPO/$HOOKS_DIR"
fi
HOOK="$HOOKS_DIR/pre-push"

ours() { [[ -f "$HOOK" ]] && grep -qF "$MARKER" "$HOOK"; }

if [[ "$UNINSTALL" -eq 1 ]]; then
  if ours; then
    rm -f "$HOOK"
    if [[ -f "$HOOK.bak" ]]; then
      mv "$HOOK.bak" "$HOOK"
      log "hook do test-graph-selector removido; hook anterior restaurado: $HOOK"
    else
      log "hook removido: $HOOK"
    fi
  elif [[ ! -e "$HOOK" && -f "$HOOK.bak" ]]; then
    mv "$HOOK.bak" "$HOOK"
    log "hook anterior restaurado: $HOOK"
  else
    log "nenhum hook do test-graph-selector em $HOOK"
  fi
  exit 0
fi

if [[ -f "$HOOK" ]] && ! ours; then
  [[ "$FORCE" -eq 1 ]] || die "ja existe um pre-push que nao e deste projeto: $HOOK (use --force para trocar; ou chame $BIN_DIR/pre-push.sh de dentro dele, repassando \"\$@\" e o stdin)"
  [[ ! -e "$HOOK.bak" ]] || die "ja existe um backup em $HOOK.bak; mova-o ou restaure-o antes de usar --force"
  mv -f "$HOOK" "$HOOK.bak"
  log "hook anterior guardado em $HOOK.bak"
fi

if [[ -n "$PROJECT" ]]; then
  [[ -d "$REPO/$PROJECT" ]] || die "projeto nao encontrado: $REPO/$PROJECT"
fi
if [[ -n "$GRAPHIFY_PATH" ]]; then
  command -v "$GRAPHIFY_PATH" >/dev/null 2>&1 || die "graphify nao encontrado: $GRAPHIFY_PATH"
  GRAPHIFY_PATH="$(cd "$(dirname "$GRAPHIFY_PATH")" && pwd)/$(basename "$GRAPHIFY_PATH")"
fi

mkdir -p "$HOOKS_DIR"
{
  echo "#!/usr/bin/env bash"
  echo "$MARKER (gerado por install-hook.sh; remova com install-hook.sh --uninstall)"
  [[ -n "$PROJECT" ]] && printf 'export TGS_PROJECT="${TGS_PROJECT:-%s}"\n' "$PROJECT"
  [[ -n "$LANG_NAME" ]] && printf 'export TGS_LANG="${TGS_LANG:-%s}"\n' "$LANG_NAME"
  [[ -n "$GRAPHIFY_PATH" ]] && printf 'export GRAPHIFY="${GRAPHIFY:-%s}"\n' "$GRAPHIFY_PATH"
  printf 'exec bash %q "$@"\n' "$BIN_DIR/pre-push.sh"
} > "$HOOK"
chmod +x "$HOOK"
log "hook instalado: $HOOK"
log "a partir de agora, 'git push' roda os testes afetados; para pular: git push --no-verify"
