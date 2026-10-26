#!/usr/bin/env bash
# Registra o comando test-graph no PATH de shells Bash ou Zsh.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/test-graph"
ENV_FILE="$CONFIG_DIR/env.sh"

case "${SHELL##*/}" in
  bash) PROFILE="$HOME/.bashrc" ;;
  zsh) PROFILE="$HOME/.zshrc" ;;
  *)
    printf 'Shell nao suportado: %s. Use Bash ou Zsh.\n' "$SHELL" >&2
    exit 1
    ;;
esac

mkdir -p "$CONFIG_DIR"
{
  printf 'export TEST_GRAPH_HOME=%q\n' "$ROOT_DIR"
  cat <<'EOF'
case ":$PATH:" in
  *":$TEST_GRAPH_HOME:"*) ;;
  *) export PATH="$TEST_GRAPH_HOME:$PATH" ;;
esac
EOF
} > "$ENV_FILE"

PROFILE_LINE='. "$HOME/.config/test-graph/env.sh"'
touch "$PROFILE"
if ! grep -Fqx "$PROFILE_LINE" "$PROFILE"; then
  printf '\n# Comando test-graph\n%s\n' "$PROFILE_LINE" >> "$PROFILE"
fi

printf 'Comando instalado. Reinicie o terminal ou execute: source %q\n' "$ENV_FILE"
printf 'Depois use: test-graph --base HEAD~1 --head HEAD --project .\n'
