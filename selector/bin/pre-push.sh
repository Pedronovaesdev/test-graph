#!/usr/bin/env bash
# pre-push.sh: hook de pre-push do git que roda so os testes afetados antes do push.
#
#   instale com: install-hook.sh   (ou chame este script do seu gerenciador de hooks)
#
# O git chama o hook com <remoto> <url> e manda no stdin uma linha por ref
# enviada: <ref local> <sha local> <ref remota> <sha remota>. Para a branch
# enviada, seleciona (select-tests.sh --dry-run) contra o merge-base com a
# branch padrao do remoto, como o PR vai fazer, e roda so os testes escolhidos.
#
# Testes falharam -> push bloqueado (exit 1). Na duvida (suite completa,
# ferramenta ausente ou com erro) o push segue com um aviso: o CI continua
# sendo a garantia, o hook so adianta o resultado.
#
# Variaveis de ambiente:
#   TGS_SKIP=1           pula o hook (o mesmo que git push --no-verify)
#   TGS_PROJECT          pasta do projeto no repositorio (padrao: .)
#   TGS_LANG             linguagem ou .yml (padrao: detecta)
#   TGS_HOOK_BASE        base da comparacao (padrao: merge-base com <remoto>/<branch padrao>)
#   TGS_HOOK_ON_FULL     warn (padrao) | run | block: quando a selecao pede a suite completa
#   TGS_HOOK_MAX_TESTS   mais testes que isso conta como suite completa (padrao: sem limite)
#   GRAPHIFY, NODE       executaveis, como no select-tests.sh

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" == /* ]] || SOURCE="$DIR/$SOURCE"
done
BIN_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"

REMOTE="${1:-origin}"
ON_FULL="${TGS_HOOK_ON_FULL:-warn}"
MAX_TESTS="${TGS_HOOK_MAX_TESTS:-}"
ZERO_SHA="0000000000000000000000000000000000000000"

log() { printf '[test-graph-selector] %s\n' "$*" >&2; }
# Erro ou duvida da ferramenta: avisa e deixa o push seguir.
allow() { log "$*"; log "push liberado; o CI roda a verificacao completa."; exit 0; }

case "$ON_FULL" in warn|run|block) ;; *) allow "TGS_HOOK_ON_FULL invalido: '$ON_FULL' (use warn, run ou block)" ;; esac
[[ -z "$MAX_TESTS" || "$MAX_TESTS" =~ ^[0-9]+$ ]] || allow "TGS_HOOK_MAX_TESTS invalido: '$MAX_TESTS'"

# Le todas as refs antes de rodar qualquer teste: o comando de teste nao pode
# consumir o stdin do git.
refs=()
while read -r local_ref local_sha _remote_ref _remote_sha; do
  [[ -n "${local_ref:-}" ]] && refs+=("$local_ref $local_sha")
done

if [[ "${TGS_SKIP:-0}" == "1" ]]; then
  log "TGS_SKIP=1: hook ignorado"
  exit 0
fi

REPO="$(git rev-parse --show-toplevel)"
PROJECT="$REPO/${TGS_PROJECT:-.}"
CURRENT="$(git rev-parse HEAD)"

# Branch padrao do remoto: refs/remotes/<remoto>/HEAD, senao main ou master.
default_branch() {
  local ref
  ref="$(git symbolic-ref --quiet "refs/remotes/$REMOTE/HEAD" 2>/dev/null)" && { echo "${ref#refs/remotes/}"; return; }
  for ref in main master; do
    git rev-parse --verify --quiet "refs/remotes/$REMOTE/$ref" >/dev/null && { echo "$REMOTE/$ref"; return; }
  done
  return 1
}

# Escolhe a ref a verificar: so branches, so a que esta no checkout (os testes
# rodam na arvore de trabalho; outra branch exigiria trocar de checkout).
target=""
for entry in "${refs[@]+"${refs[@]}"}"; do
  ref="${entry% *}"
  sha="${entry#* }"
  [[ "$ref" == refs/heads/* && "$sha" != "$ZERO_SHA" ]] || continue
  if [[ "$sha" == "$CURRENT" ]]; then
    target="$sha"
  else
    log "aviso: ${ref#refs/heads/} nao esta no checkout atual; nao verificada aqui"
  fi
done
[[ -n "$target" ]] || exit 0

if [[ -n "${TGS_HOOK_BASE:-}" ]]; then
  base="$TGS_HOOK_BASE"
else
  upstream="$(default_branch)" || allow "nao achei a branch padrao de '$REMOTE' (defina TGS_HOOK_BASE)"
  base="$(git merge-base "$target" "$upstream")" || allow "sem merge-base entre HEAD e $upstream"
fi
[[ "$(git rev-parse "$base^{commit}" 2>/dev/null)" == "$target" ]] && exit 0  # nada novo

# Os testes rodam na arvore de trabalho: mudancas nao commitadas entram neles.
if ! git diff --quiet HEAD -- 2>/dev/null; then
  log "aviso: ha mudancas nao commitadas; os testes rodam com elas, nao exatamente com o commit enviado"
fi

command -v "${NODE:-node}" >/dev/null 2>&1 || allow "node nao encontrado"
command -v "${GRAPHIFY:-graphify}" >/dev/null 2>&1 \
  || allow "indexador '${GRAPHIFY:-graphify}' nao encontrado (pip install graphifyy==0.9.90, ou GRAPHIFY=<caminho>)"

OUT="$(mktemp -d "${TMPDIR:-/tmp}/tgs-hook.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

args=(--project "$PROJECT" --base "$base" --head HEAD --dry-run --out-dir "$OUT")
[[ -n "${TGS_LANG:-}" ]] && args+=(--lang "$TGS_LANG")
log "selecionando testes afetados desde $(git rev-parse --short "$base")"
# O log do indexador so aparece se a selecao falhar.
if ! bash "$BIN_DIR/select-tests.sh" "${args[@]}" >/dev/null 2>"$OUT/select.log" </dev/null; then
  cat "$OUT/select.log" >&2
  allow "a selecao falhou"
fi

mode="$(cat "$OUT/mode.txt")"
cmd="$(cat "$OUT/command.txt")"
count="$(grep -c . "$OUT/selected-tests.txt" || true)"
"${NODE:-node}" -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stderr.write(`[test-graph-selector] ${r.mode}: ${r.summary.selected} de ${r.summary.total} testes\n`);
' "$OUT/report.json" || true

if [[ "$mode" == "none" ]]; then
  log "nenhum teste afetado: nada a rodar"
  exit 0
fi
if [[ "$mode" == "selective" && -n "$MAX_TESTS" && "$count" -gt "$MAX_TESTS" ]]; then
  log "$count testes passam do limite TGS_HOOK_MAX_TESTS=$MAX_TESTS: tratando como suite completa"
  mode="full"
fi
if [[ "$mode" == "full" ]]; then
  case "$ON_FULL" in
    warn) allow "a mudanca pede a suite completa; ela nao roda aqui (TGS_HOOK_ON_FULL=run para rodar)" ;;
    block)
      log "a mudanca pede a suite completa e TGS_HOOK_ON_FULL=block: push bloqueado"
      log "rode a suite e use 'git push --no-verify', ou mude TGS_HOOK_ON_FULL"
      exit 1 ;;
  esac
fi

log "rodando $count teste(s) em ${TGS_PROJECT:-.}: $cmd"
if (cd "$PROJECT" && eval "$cmd") </dev/null; then
  log "testes OK: push liberado"
  exit 0
fi
log "testes FALHARAM: push bloqueado (relatorio: rode select-tests.sh --dry-run --base $(git rev-parse --short "$base"))"
log "para enviar mesmo assim: git push --no-verify"
exit 1
