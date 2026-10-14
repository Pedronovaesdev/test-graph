#!/usr/bin/env bash
# Uso: scripts/select-tests-node.sh <base_ref> <head_ref> <dir_do_projeto_alvo> [caminho_do_jar]
#
# Mesma ideia do select-tests.sh (Java): extractors/node/extract-graph.mjs
# (via ts-morph) gera o grafo em JSON, o mesmo motor Java (--graph-json)
# seleciona os testes, e o Jest roda so eles.
set -euo pipefail

BASE_REF="${1:-HEAD~1}"
HEAD_REF="${2:-HEAD}"
TARGET_DIR="${3:-.}"
TOOL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL_JAR="${4:-$TOOL_ROOT/target/test-graph-selector-0.1.0-SNAPSHOT.jar}"
EXTRACTOR="$TOOL_ROOT/extractors/node/extract-graph.mjs"

if [ ! -f "$TOOL_JAR" ]; then
  echo "erro: jar nao encontrado em $TOOL_JAR (rode 'mvn package' (ou mvnw) na raiz primeiro)" >&2
  exit 1
fi
TOOL_JAR="$(cd "$(dirname "$TOOL_JAR")" && pwd)/$(basename "$TOOL_JAR")"

cd "$TARGET_DIR"
TARGET_ABS="$(pwd)"

CHANGED_FILES="$(mktemp)"
GRAPH_JSON="$(mktemp)"
trap 'rm -f "$CHANGED_FILES" "$GRAPH_JSON"' EXIT

git diff --name-only "$BASE_REF" "$HEAD_REF" -- '*.ts' '*.tsx' '*.js' '*.jsx' > "$CHANGED_FILES"

if [ ! -s "$CHANGED_FILES" ]; then
  echo "Nenhum arquivo .ts/.tsx/.js/.jsx alterado entre $BASE_REF e $HEAD_REF. Nada a testar."
  exit 0
fi

echo "Arquivos alterados:"
cat "$CHANGED_FILES"
echo

node "$EXTRACTOR" --repo-root "$TARGET_ABS" --out "$GRAPH_JSON"

SELECTED_TESTS="$(java -jar "$TOOL_JAR" \
  --graph-json "$GRAPH_JSON" \
  --changed-files "$CHANGED_FILES" \
  --format csv)"

if [ -z "$SELECTED_TESTS" ]; then
  echo "Nenhum teste depende dos arquivos alterados."
  exit 0
fi

TEST_PATHS="$(echo "$SELECTED_TESTS" | tr ',' ' ')"
echo "Testes selecionados: $TEST_PATHS"
npx jest $TEST_PATHS
