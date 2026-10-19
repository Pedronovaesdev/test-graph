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

# Validar as referencias antes de compilar/indexar. Referencias invalidas sao
# erro de entrada (exit 2), nao uma falha de analise que possa ser mascarada.
git -C "$PROJECT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "commit base invalido: $BASE"
git -C "$PROJECT" rev-parse --verify --quiet "$HEAD^{commit}" >/dev/null || die "commit head invalido: $HEAD"

# Sem diff entre os commits nao ha analise nem executor a iniciar.
if git -C "$PROJECT" diff --quiet "$BASE...$HEAD" --; then
  log "base e head nao tem diferencas: nada a executar"
  exit 0
else
  diff_status=$?
  [[ "$diff_status" -eq 1 ]] || die "nao consegui comparar base e head"
fi

if [[ -z "$LANG_NAME" ]]; then
  if [[ -f "$PROJECT/package.json" ]] && compgen -G "$PROJECT/vitest.config.*" >/dev/null; then LANG_NAME="vitest"
  elif [[ -f "$PROJECT/package.json" ]]; then LANG_NAME="typescript"
  elif [[ -f "$PROJECT/pom.xml" ]]; then LANG_NAME="java"
  elif [[ -f "$PROJECT/build.gradle" || -f "$PROJECT/build.gradle.kts" ]]; then LANG_NAME="java-gradle"
  elif [[ -f "$PROJECT/pyproject.toml" || -f "$PROJECT/setup.py" || -f "$PROJECT/pytest.ini" ]]; then LANG_NAME="python"
  else die "nao consegui detectar a linguagem; use --lang"
  fi
fi
[[ -f "$SELECTOR_DIR/languages/$LANG_NAME.yml" ]] || die "linguagem sem configuracao: $LANG_NAME (crie languages/$LANG_NAME.yml no pacote)"

# Pré-validar o executor antes da indexacao. Assim, ambiente incompleto falha
# com uma mensagem direta em vez de gastar tempo e falhar no fim do pipeline.
case "$LANG_NAME" in
  java)
    command -v java >/dev/null 2>&1 || die "Java nao encontrado (instale Java 17+ para executar Maven)"
    command -v mvn >/dev/null 2>&1 || die "Maven (mvn) nao encontrado"
    ;;
  java-gradle)
    command -v java >/dev/null 2>&1 || die "Java nao encontrado (instale Java 17+ para executar Gradle)"
    [[ -x "$PROJECT/gradlew" ]] || die "wrapper Gradle executavel nao encontrado: $PROJECT/gradlew"
    ;;
  python)
    command -v python >/dev/null 2>&1 || die "Python (python) nao encontrado"
    python -c 'import pytest' >/dev/null 2>&1 || die "pytest nao encontrado no Python ativo (instale pytest no ambiente do projeto)"
    ;;
  typescript|vitest)
    command -v npx >/dev/null 2>&1 || die "npx nao encontrado (instale Node.js 18+ e npm)"
    test_runner="jest"
    [[ "$LANG_NAME" == "vitest" ]] && test_runner="vitest"
    repo_root="$(git -C "$PROJECT" rev-parse --show-toplevel)"
    if ! command -v "$test_runner" >/dev/null 2>&1 \
      && [[ ! -x "$PROJECT/node_modules/.bin/$test_runner" ]] \
      && [[ ! -x "$repo_root/node_modules/.bin/$test_runner" ]]; then
      die "$test_runner nao encontrado nas dependencias do projeto (instale as dependencias npm)"
    fi
    ;;
  *) die "linguagem sem validacao de ambiente: $LANG_NAME" ;;
esac

OUT_DIR="${OUT_DIR:-$PROJECT/.selector-out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
GRAPH_DIR="$PROJECT/graphify-out"

# Comando da suite completa sem depender do seletor (usado no fail-safe).
default_full_command() {
  if [[ -n "${FULL_SUITE_COMMAND:-}" ]]; then echo "$FULL_SUITE_COMMAND"; return; fi
  sed -n 's/^full_command: *"\(.*\)" *$/\1/p' "$SELECTOR_DIR/languages/$LANG_NAME.yml"
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

# Gera o grafo de um commit. Se o commit for o checkout atual, indexa no
# lugar (aproveita o cache por arquivo em graphify-out/cache). Senao, cria um
# git worktree temporario daquele commit e indexa la.
# O grafo e sempre do commit analisado; o cache e so por conteudo de arquivo.
build_graph() {
  local rev="$1" out="$2" commit current repo prefix wt
  commit="$(git -C "$PROJECT" rev-parse --verify "$rev^{commit}")" || return 1
  current="$(git -C "$PROJECT" rev-parse HEAD)"
  if [[ "$commit" == "$current" && "$out" == "$GRAPH_DIR" ]]; then
    "$GRAPHIFY" extract "$PROJECT" --no-cluster --code-only >&2 || return 1
    return 0
  fi
  repo="$(git -C "$PROJECT" rev-parse --show-toplevel)"
  prefix="$(git -C "$PROJECT" rev-parse --show-prefix)"
  wt="$(mktemp -d "${TMPDIR:-/tmp}/select-tests-wt.XXXXXX")"
  rmdir "$wt"
  git -C "$repo" worktree add --detach --quiet "$wt" "$commit" >&2 || return 1
  WORKTREES+=("$wt")
  mkdir -p "$out"
  "$GRAPHIFY" extract "$wt/$prefix" --no-cluster --code-only --out "$out" >&2 || return 1
  # --out DIR grava em DIR/graphify-out/graph.json
  [[ -f "$out/graphify-out/graph.json" ]] && mv -f "$out/graphify-out/graph.json" "$out/graph.json"
  return 0
}

selector() { "$NODE" "$SELECTOR_DIR/dist/cli.js" "$@"; }

# --- 2. ferramenta: seletor compilado + indexador --------------------------
command -v "$NODE" >/dev/null 2>&1 || fail_safe "node nao encontrado"
# Compila se faltar o dist/ ou se algum fonte for mais novo que ele (evita
# rodar uma versao velha do seletor depois de editar selector/src).
if [[ -d "$SELECTOR_DIR/src" ]] && { [[ ! -f "$SELECTOR_DIR/dist/cli.js" ]]    || [[ -n "$(find "$SELECTOR_DIR/src" -name '*.ts' -newer "$SELECTOR_DIR/dist/cli.js" 2>/dev/null | head -1)" ]]; }; then
  log "compilando o seletor"
  (cd "$SELECTOR_DIR" && { [[ -d node_modules ]] || npm ci --silent; } && npm run --silent build) >&2 \
    || fail_safe "nao consegui compilar o seletor"
fi
command -v "$GRAPHIFY" >/dev/null 2>&1 || fail_safe "indexador '$GRAPHIFY' nao encontrado (pip install graphifyy==0.9.90)"

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
selector select --project "$PROJECT" --base "$BASE" --head "$HEAD" --lang "$LANG_NAME" \
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
