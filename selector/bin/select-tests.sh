#!/usr/bin/env bash
# select-tests.sh: roda so os testes afetados por um diff, explicando o porque.
#
#   ./select-tests.sh --base origin/main --head HEAD [--project DIR]
#                     [--lang typescript|vitest|java|java-gradle|python] [--dry-run] [--format text|json|md]
#                     [--out-dir DIR]
#
# Passos: valida dependencias -> gera o grafo do head (e do base, se houver
# remocao/renomeacao) com o indexador AST -> chama o seletor -> imprime a
# explicacao -> executa o comando de teste da linguagem.
#
# Codigos de saida: 0 = testes ok (ou nada a rodar), 1 = testes falharam,
# 2 = erro da ferramenta sem como executar testes (ex.: --dry-run, uso invalido).
# Se a selecao falhar por qualquer motivo, cai para a SUITE COMPLETA: um erro
# da ferramenta nunca deixa de testar.
#
# Variaveis de ambiente:
#   GRAPHIFY    executavel do indexador (padrao: graphify)
#   NODE        executavel do Node (padrao: node)
#   FULL_SUITE_COMMAND  sobrescreve o comando da suite completa
#   TGS_NO_BUILD=1      usa o dist/cli.js como esta, sem nunca recompilar

set -euo pipefail

# Resolve links (o npm instala o comando como symlink em .../bin/select-tests).
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" == /* ]] || SOURCE="$DIR/$SOURCE"
done
# Raiz do pacote: selector/ no repositorio, ou node_modules/test-graph-selector/ instalado.
SELECTOR_DIR="$(cd "$(dirname "$SOURCE")/.." && pwd)"
GRAPHIFY="${GRAPHIFY:-graphify}"
NODE="${NODE:-node}"

BASE=""
HEAD="HEAD"
PROJECT="."
LANG_NAME=""
DRY_RUN=0
FORMAT="text"
OUT_DIR=""

log() { printf '[select-tests] %s\n' "$*" >&2; }
die() { log "erro: $*"; exit 2; }

usage() {
  sed -n '2,8p' "$SOURCE" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:?--base precisa de valor}"; shift 2 ;;
    --head) HEAD="${2:?--head precisa de valor}"; shift 2 ;;
    --project) PROJECT="${2:?--project precisa de valor}"; shift 2 ;;
    --lang) LANG_NAME="${2:?--lang precisa de valor}"; shift 2 ;;
    --format) FORMAT="${2:?--format precisa de valor}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:?--out-dir precisa de valor}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "argumento desconhecido: $1" ;;
  esac
done

[[ -n "$BASE" ]] || { usage >&2; die "faltou --base"; }
case "$FORMAT" in text|json|md) ;; *) die "--format invalido: $FORMAT" ;; esac

# --- 1. dependencias minimas (sem elas nem a suite completa roda) ---------
command -v git >/dev/null 2>&1 || die "git nao encontrado"
[[ -d "$PROJECT" ]] || die "projeto nao encontrado: $PROJECT"
PROJECT="$(cd "$PROJECT" && pwd)"
git -C "$PROJECT" rev-parse --git-dir >/dev/null 2>&1 || die "$PROJECT nao esta num repositorio git"

if [[ -z "$LANG_NAME" ]]; then
  if [[ -f "$PROJECT/package.json" ]] && compgen -G "$PROJECT/vitest.config.*" >/dev/null; then LANG_NAME="vitest"
  elif [[ -f "$PROJECT/package.json" ]]; then LANG_NAME="typescript"
  elif [[ -f "$PROJECT/pom.xml" ]]; then LANG_NAME="java"
  elif [[ -f "$PROJECT/build.gradle" || -f "$PROJECT/build.gradle.kts" ]]; then LANG_NAME="java-gradle"
  elif [[ -f "$PROJECT/pyproject.toml" || -f "$PROJECT/setup.py" || -f "$PROJECT/pytest.ini" ]]; then LANG_NAME="python"
  else die "nao consegui detectar a linguagem; use --lang"
  fi
fi
# --lang aceita um nome (typescript, java...) ou o caminho de um .yml do
# proprio projeto (ex.: .github/test-selector.yml com `extends: typescript`).
case "$LANG_NAME" in
  *.yml|*.yaml)
    if [[ -f "$LANG_NAME" ]]; then LANG_FILE="$(cd "$(dirname "$LANG_NAME")" && pwd)/$(basename "$LANG_NAME")"
    elif [[ -f "$PROJECT/$LANG_NAME" ]]; then LANG_FILE="$PROJECT/$LANG_NAME"
    else die "arquivo de configuracao nao encontrado: $LANG_NAME"
    fi ;;
  *)
    LANG_FILE="$SELECTOR_DIR/languages/$LANG_NAME.yml"
    [[ -f "$LANG_FILE" ]] || die "linguagem sem configuracao: $LANG_NAME (crie languages/$LANG_NAME.yml no pacote, ou passe o caminho de um .yml)" ;;
esac

OUT_DIR="${OUT_DIR:-$PROJECT/.selector-out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
GRAPH_DIR="$PROJECT/graphify-out"

# Comando da suite completa sem depender do seletor (usado no fail-safe).
default_full_command() {
  if [[ -n "${FULL_SUITE_COMMAND:-}" ]]; then echo "$FULL_SUITE_COMMAND"; return; fi
  local cmd base
  cmd="$(sed -n 's/^full_command: *"\(.*\)" *$/\1/p' "$LANG_FILE")"
  if [[ -z "$cmd" ]]; then
    # config do projeto sem full_command proprio: usa o da configuracao herdada
    base="$(sed -n 's/^extends: *"\{0,1\}\([A-Za-z0-9_-]*\)"\{0,1\} *$/\1/p' "$LANG_FILE")"
    if [[ -n "$base" && -f "$SELECTOR_DIR/languages/$base.yml" ]]; then
      cmd="$(sed -n 's/^full_command: *"\(.*\)" *$/\1/p' "$SELECTOR_DIR/languages/$base.yml")"
    fi
  fi
  echo "$cmd"
}

run_tests() {
  local cmd="$1"
  log "executando em $PROJECT: $cmd"
  if (cd "$PROJECT" && eval "$cmd"); then
    log "testes OK"
    return 0
  fi
  log "testes FALHARAM"
  return 1
}

fail_safe() {
  log "AVISO: a selecao falhou ($1). Fail-safe: rodando a SUITE COMPLETA."
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '## Selecao de testes\n\n**FAIL-SAFE: suite completa** (a ferramenta falhou: %s)\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "--dry-run: nada executado"
    exit 2
  fi
  local cmd
  cmd="$(default_full_command)"
  [[ -n "$cmd" ]] || die "sem comando de suite completa para $LANG_NAME"
  run_tests "$cmd" && exit 0 || exit 1
}

WORKTREES=()
cleanup() {
  local wt
  for wt in "${WORKTREES[@]+"${WORKTREES[@]}"}"; do
    git -C "$PROJECT" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
  done
}
trap cleanup EXIT

# Python do ambiente do graphify (mesmo diretorio do executavel), para rodar o
# graphify-fast.py. Vazio = chama o graphify direto. GRAPHIFY_FAST=0 desliga.
GRAPHIFY_PY=""
find_graphify_python() {
  [[ "${GRAPHIFY_FAST:-1}" == "0" ]] && return 0
  local exe dir py
  exe="$(command -v "$GRAPHIFY" 2>/dev/null)" || return 0
  dir="$(dirname "$exe")"
  for py in "$dir/python" "$dir/python.exe" "$dir/python3"; do
    if [[ -x "$py" ]] && "$py" -c "import graphify.build, graphify.__main__" >/dev/null 2>&1; then
      GRAPHIFY_PY="$py"
      return 0
    fi
  done
}

# Roda o graphify pelo graphify-fast.py; se falhar, cai para o graphify normal.
run_graphify() {
  if [[ -n "$GRAPHIFY_PY" ]]; then
    PYTHONHASHSEED=0 "$GRAPHIFY_PY" "$SELECTOR_DIR/bin/graphify-fast.py" "$@" && return 0
    log "graphify-fast falhou; repetindo com o graphify normal"
  fi
  "$GRAPHIFY" "$@"
}

# Gera o grafo de um commit. Se o commit for o checkout atual, indexa no
# lugar (aproveita o cache por arquivo em graphify-out/cache). Senao, cria um
# git worktree temporario daquele commit e indexa la.
# O grafo e sempre do commit analisado; o cache e so por conteudo de arquivo.
build_graph() {
  local rev="$1" out="$2" commit current repo prefix wt
  commit="$(git -C "$PROJECT" rev-parse --verify "$rev^{commit}")" || return 1
  current="$(git -C "$PROJECT" rev-parse HEAD)"
  if [[ "$commit" == "$current" && "$out" == "$GRAPH_DIR" ]]; then
    run_graphify extract "$PROJECT" --no-cluster --code-only >&2 || return 1
    return 0
  fi
  repo="$(git -C "$PROJECT" rev-parse --show-toplevel)"
  prefix="$(git -C "$PROJECT" rev-parse --show-prefix)"
  wt="$(mktemp -d "${TMPDIR:-/tmp}/select-tests-wt.XXXXXX")"
  rmdir "$wt"
  git -C "$repo" worktree add --detach --quiet "$wt" "$commit" >&2 || return 1
  WORKTREES+=("$wt")
  mkdir -p "$out"
  run_graphify extract "$wt/$prefix" --no-cluster --code-only --out "$out" >&2 || return 1
  # --out DIR grava em DIR/graphify-out/graph.json
  [[ -f "$out/graphify-out/graph.json" ]] && mv -f "$out/graphify-out/graph.json" "$out/graph.json"
  return 0
}

selector() { "$NODE" "$SELECTOR_DIR/dist/cli.js" "$@"; }

# --- 2. ferramenta: seletor compilado + indexador --------------------------
command -v "$NODE" >/dev/null 2>&1 || fail_safe "node nao encontrado"
# O dist/cli.js vem pronto (versionado e no pacote npm). Compila so se ele
# faltar ou, numa maquina de desenvolvimento (com node_modules), se algum fonte
# for mais novo que ele. Num clone novo as datas dos arquivos sao as do
# checkout, entao a comparacao por data fica de fora. TGS_NO_BUILD=1 nunca compila.
needs_build() {
  [[ "${TGS_NO_BUILD:-0}" == "1" || ! -d "$SELECTOR_DIR/src" ]] && return 1
  [[ ! -f "$SELECTOR_DIR/dist/cli.js" ]] && return 0
  [[ -d "$SELECTOR_DIR/node_modules" ]] \
    && [[ -n "$(find "$SELECTOR_DIR/src" -name '*.ts' -newer "$SELECTOR_DIR/dist/cli.js" 2>/dev/null | head -1)" ]]
}
if needs_build; then
  log "compilando o seletor"
  (cd "$SELECTOR_DIR" && { [[ -d node_modules ]] || npm ci --silent; } && npm run --silent build) >&2 \
    || fail_safe "nao consegui compilar o seletor"
fi
command -v "$GRAPHIFY" >/dev/null 2>&1 || fail_safe "indexador '$GRAPHIFY' nao encontrado (pip install graphifyy==0.9.90)"
find_graphify_python

git -C "$PROJECT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || fail_safe "commit base invalido: $BASE"
git -C "$PROJECT" rev-parse --verify --quiet "$HEAD^{commit}" >/dev/null || fail_safe "commit head invalido: $HEAD"

# --- 3. grafos -------------------------------------------------------------
log "indexando o head ($HEAD)"
HEAD_GRAPH="$GRAPH_DIR/graph.json"
if [[ "$(git -C "$PROJECT" rev-parse "$HEAD^{commit}")" == "$(git -C "$PROJECT" rev-parse HEAD)" ]]; then
  build_graph "$HEAD" "$GRAPH_DIR" || fail_safe "indexacao do head falhou"
else
  build_graph "$HEAD" "$GRAPH_DIR/head" || fail_safe "indexacao do head falhou"
  HEAD_GRAPH="$GRAPH_DIR/head/graph.json"
fi

BASE_ARGS=()
NEEDS_BASE="$(selector needs-base --project "$PROJECT" --base "$BASE" --head "$HEAD")" || fail_safe "leitura do diff falhou"
if [[ "$NEEDS_BASE" == "yes" ]]; then
  # O diff de tres pontos compara contra o merge-base: o grafo do base e dele.
  MERGE_BASE="$(git -C "$PROJECT" merge-base "$BASE" "$HEAD")" || fail_safe "merge-base nao encontrado"
  log "diff tem remocao/renomeacao: indexando tambem o base ($MERGE_BASE)"
  build_graph "$MERGE_BASE" "$GRAPH_DIR/base" || fail_safe "indexacao do base falhou"
  BASE_ARGS=(--base-graph "$GRAPH_DIR/base/graph.json")
fi

# --- 4. selecao + explicacao ----------------------------------------------
selector select --project "$PROJECT" --base "$BASE" --head "$HEAD" --lang "$LANG_FILE" \
  --head-graph "$HEAD_GRAPH" "${BASE_ARGS[@]+"${BASE_ARGS[@]}"}" \
  --format "$FORMAT" --out-dir "$OUT_DIR" || fail_safe "o seletor terminou com erro"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$OUT_DIR/report.md" >> "$GITHUB_STEP_SUMMARY"
fi

MODE="$(cat "$OUT_DIR/mode.txt")"
COMMAND="$(cat "$OUT_DIR/command.txt")"
log "relatorios em $OUT_DIR (report.txt, report.json, report.md)"

# --- 5. execucao -------------------------------------------------------------
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "--dry-run: comando nao executado"
  exit 0
fi
if [[ "$MODE" == "none" ]]; then
  log "nenhum teste afetado pelo diff: nada a executar (sucesso)"
  exit 0
fi
run_tests "$COMMAND" && exit 0 || exit 1
