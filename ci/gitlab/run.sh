#!/usr/bin/env bash
# run.sh: o equivalente da GitHub Action (action.yml) para o GitLab CI.
# Chamado pelo template ci/gitlab/test-graph-selector.yml, dentro do job.
#
# Faz o que os passos da Action fazem: instala o graphify num venv proprio,
# restaura o cache do indexador, define a base da comparacao a partir das
# variaveis do GitLab, roda select-tests.sh e grava as saidas em tgs-report/.
#
# Variaveis (todas opcionais):
#   TGS_PROJECT        pasta do projeto no repositorio (padrao: .)
#   TGS_LANG           typescript, angular, vitest, java, java-gradle, python ou um .yml
#   TGS_BASE           commit de comparacao (padrao: base do MR ou commit anterior ao push)
#   TGS_HEAD           commit analisado (padrao: HEAD)
#   TGS_DRY_RUN        true = so seleciona e explica, sem rodar os testes
#   TGS_SKIP_TESTED_TREE  true = pula tudo se este conteudo (tree do git) ja
#                      passou com a mesma ferramenta, configuracao e imagem
#   GRAPHIFY_VERSION   versao do indexador (padrao: 0.9.90)
#   GRAPHIFY           executavel do graphify ja instalado (pula a instalacao)
#
# Saidas em tgs-report/ (na raiz do repositorio):
#   report.txt, report.json, report.md   o relatorio do seletor
#   selected-tests.txt, command.txt      os testes escolhidos e o comando
#   tgs.env                             TGS_MODE, TGS_SELECTED, TGS_TOTAL (dotenv)
#                                       TGS_MODE=skipped: arvore ja testada

set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${TGS_PROJECT:-.}"
HEAD_REF="${TGS_HEAD:-HEAD}"
GRAPHIFY_VERSION="${GRAPHIFY_VERSION:-0.9.90}"
REPORT_DIR="tgs-report"
CACHE_DIR=".tgs-cache"
ZERO_SHA="0000000000000000000000000000000000000000"

log() { printf '[test-graph-selector] %s\n' "$*" >&2; }

rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

# --- arvore ja testada -----------------------------------------------------
# Mesmo conteudo (tree do git) que ja passou, com a mesma ferramenta,
# configuracao e imagem: nada mudou para os testes, entao nao roda de novo.
# Pega re-runs, rebases sem mudanca de conteudo e pipelines duplicadas. O que
# esta fora do repositorio (servicos, segredos) nao entra na chave: por isso e
# opcional. A lista fica no cache do job, em .tgs-cache/tested-trees.txt.
TESTED="$CACHE_DIR/tested-trees.txt"
tree_key=""
if [[ "${TGS_SKIP_TESTED_TREE:-false}" == "true" && "${TGS_DRY_RUN:-false}" != "true" ]]; then
  tree_key="$(
    {
      git rev-parse "$HEAD_REF^{tree}"
      printf '%s\n' "$PROJECT" "${TGS_LANG:-}" "$GRAPHIFY_VERSION" "${CI_JOB_IMAGE:-}"
      cat "$TOOL_DIR/selector/dist/cli.js" "$TOOL_DIR"/selector/languages/*.yml
    } | git hash-object --stdin
  )"
  if [[ -f "$TESTED" ]] && grep -qxF "$tree_key" "$TESTED"; then
    log "arvore $(git rev-parse --short "$HEAD_REF^{tree}") ja testada com sucesso: nada a rodar"
    printf 'Arvore ja testada com sucesso (chave %s): testes pulados.\n' "$tree_key" > "$REPORT_DIR/report.txt"
    printf 'TGS_MODE=skipped\nTGS_SELECTED=0\n' > "$REPORT_DIR/tgs.env"
    exit 0
  fi
fi

# --- graphify num venv proprio (nao mexe no Python do projeto) -------------
if [[ -z "${GRAPHIFY:-}" ]]; then
  command -v python3 >/dev/null || { log "erro: python3 nao encontrado na imagem do job"; exit 2; }
  venv="${TMPDIR:-/tmp}/tgs-venv"
  python3 -m venv "$venv" || { log "erro: 'python3 -m venv' falhou (em Debian/Ubuntu: apt-get install -y python3-venv)"; exit 2; }
  "$venv/bin/pip" install --quiet --disable-pip-version-check "graphifyy==$GRAPHIFY_VERSION"
  export GRAPHIFY="$venv/bin/graphify"
fi

# --- Node: o seletor vem pronto em selector/dist/cli.js --------------------
command -v node >/dev/null || { log "erro: Node.js nao encontrado na imagem do job (use uma imagem com Node 18+)"; exit 2; }
log "node $(node --version)"

# --- cache do indexador ----------------------------------------------------
# O cache do GitLab so guarda caminhos fixos; o graphify grava em
# <projeto>/graphify-out. Copia de .tgs-cache/ antes e de volta depois.
if [[ -d "$CACHE_DIR/graphify-out" && ! -d "$PROJECT/graphify-out" ]]; then
  cp -a "$CACHE_DIR/graphify-out" "$PROJECT/graphify-out"
  log "cache do indexador restaurado"
fi

# --- base da comparacao ----------------------------------------------------
base="${TGS_BASE:-}"
if [[ -z "$base" ]]; then
  if [[ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ]]; then
    base="$CI_MERGE_REQUEST_DIFF_BASE_SHA"    # merge request: o merge-base com o destino
  elif [[ -n "${CI_COMMIT_BEFORE_SHA:-}" && "$CI_COMMIT_BEFORE_SHA" != "$ZERO_SHA" ]]; then
    base="$CI_COMMIT_BEFORE_SHA"              # push: o commit anterior ao push
  fi
fi
if [[ -n "$base" ]] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git fetch --quiet origin "$base" 2>/dev/null || true
fi
if [[ -z "$base" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
    if [[ -z "$base" ]]; then
      log "aviso: sem base (push de branch nova?); comparando com HEAD~1."
    else
      log "aviso: base '$base' indisponivel; comparando com HEAD~1. Use GIT_DEPTH: 0."
    fi
    base="$(git rev-parse HEAD~1)"
  else
    log "aviso: sem historico para comparar (clone raso?). Use GIT_DEPTH: 0."
    base="$(git rev-parse HEAD)"
  fi
fi

# --- selecao e execucao ----------------------------------------------------
args=(--base "$base" --head "$HEAD_REF" --project "$PROJECT" --out-dir "$REPORT_DIR")
[[ -n "${TGS_LANG:-}" ]] && args+=(--lang "$TGS_LANG")
[[ "${TGS_DRY_RUN:-false}" == "true" ]] && args+=(--dry-run)

set +e
TGS_NO_BUILD=1 bash "$TOOL_DIR/selector/bin/select-tests.sh" "${args[@]}"
code=$?
set -e

# --- saidas ----------------------------------------------------------------
if [[ -f "$REPORT_DIR/report.json" ]]; then
  node -e '
    const r = require(require("path").resolve(process.argv[1]));
    const lines = [`TGS_MODE=${r.mode}`, `TGS_SELECTED=${r.summary.selected}`, `TGS_TOTAL=${r.summary.total}`];
    require("fs").writeFileSync(process.argv[2], lines.join("\n") + "\n");
  ' "$REPORT_DIR/report.json" "$REPORT_DIR/tgs.env"
else
  printf 'TGS_MODE=fail-safe\n' > "$REPORT_DIR/tgs.env"
fi

if [[ -d "$PROJECT/graphify-out" ]]; then
  rm -rf "$CACHE_DIR/graphify-out"
  mkdir -p "$CACHE_DIR"
  cp -a "$PROJECT/graphify-out" "$CACHE_DIR/graphify-out"
fi

if [[ -n "$tree_key" && "$code" -eq 0 ]]; then
  mkdir -p "$CACHE_DIR"
  echo "$tree_key" >> "$TESTED"
  tail -n 500 "$TESTED" > "$TESTED.tmp" && mv -f "$TESTED.tmp" "$TESTED"
fi

exit $code
