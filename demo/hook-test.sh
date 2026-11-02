#!/usr/bin/env bash
# hook-test.sh: testa o hook de pre-push (selector/bin/pre-push.sh) com pushes
# de verdade para um remoto local, no demo TypeScript.
#
#   demo/hook-test.sh
#
# Cada caso cria uma branch a partir da main, faz uma mudanca, da push e
# confere se o push passou ou foi bloqueado, e a mensagem do hook.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="$(setup_repo typescript)"
REMOTE="$DEMO_DIR/.work/typescript-remote.git"
LOG="$DEMO_DIR/.work/hook.log"
rm -rf "$REMOTE"
git init -q --bare -b main "$REMOTE"
git -C "$REPO" remote add origin "$REMOTE"
git -C "$REPO" push -q origin main 2>/dev/null

install_args=()
[[ -n "${GRAPHIFY:-}" ]] && install_args+=(--graphify "$GRAPHIFY")
(cd "$REPO" && bash "$ROOT_DIR/selector/bin/install-hook.sh" "${install_args[@]+"${install_args[@]}"}")

failures=0
n=0

# caso <nome> <esperado: ok|bloqueado> <trecho da saida> <mudanca> [env do push...]
caso() {
  local name="$1" expected="$2" needle="$3" change="$4" branch got
  shift 4
  n=$((n + 1))
  branch="caso-$n"
  git -C "$REPO" checkout -q -b "$branch" main
  commit_change "$REPO" "$name" "$change"
  if (cd "$REPO" && env "$@" git push -q origin "$branch") >"$LOG" 2>&1; then got=ok; else got=bloqueado; fi
  git -C "$REPO" checkout -q main
  if [[ "$got" == "$expected" ]] && grep -qF -- "$needle" "$LOG"; then
    echo "ok   $n. $name: $got" >&2
  else
    echo "FALHOU $n. $name: esperado $expected com '$needle', veio $got" >&2
    sed 's/^/       | /' "$LOG" >&2
    failures=$((failures + 1))
  fi
}

BUG="sed -i.bak 's/return a + b/return a - b/' src/utils/math.ts && rm src/utils/math.ts.bak"

caso "mudanca com testes passando" ok "testes OK: push liberado" \
  "echo '// comentario' >> src/utils/math.ts"
caso "bug pego por um teste selecionado" bloqueado "testes FALHARAM: push bloqueado" "$BUG"
caso "so documentacao" ok "nenhum teste afetado" \
  "echo '# notas' > NOTAS.md"
caso "package.json pede a suite completa" ok "pede a suite completa" \
  "echo >> package.json"
caso "suite completa com TGS_HOOK_ON_FULL=block" bloqueado "push bloqueado" \
  "echo >> package.json" TGS_HOOK_ON_FULL=block
caso "selecao acima de TGS_HOOK_MAX_TESTS" ok "passam do limite" \
  "echo '// comentario' >> src/utils/math.ts" TGS_HOOK_MAX_TESTS=1
caso "indexador ausente nao trava o push" ok "nao encontrado" "$BUG" GRAPHIFY=/nao/existe/graphify
caso "TGS_SKIP=1 pula o hook" ok "hook ignorado" "$BUG" TGS_SKIP=1

# O bloqueio vale de verdade: a branch com bug nao chegou ao remoto.
if git -C "$REMOTE" rev-parse --verify --quiet refs/heads/caso-2 >/dev/null; then
  echo "FALHOU: caso-2 (bug) chegou ao remoto" >&2
  failures=$((failures + 1))
fi

(cd "$REPO" && bash "$ROOT_DIR/selector/bin/install-hook.sh" --uninstall)
[[ ! -f "$REPO/.git/hooks/pre-push" ]] || { echo "FALHOU: --uninstall nao removeu o hook" >&2; failures=$((failures + 1)); }

echo >&2
if [[ "$failures" -eq 0 ]]; then
  echo "== OK: $n casos do hook de pre-push" >&2
  exit 0
fi
echo "== $failures falha(s)" >&2
exit 1
