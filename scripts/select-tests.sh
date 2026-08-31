#!/usr/bin/env bash
# Uso: scripts/select-tests.sh <base_ref> <head_ref> <dir_do_projeto_alvo> [caminho_do_jar]
#
# Le o diff entre base_ref e head_ref, roda o test-graph-selector sobre o projeto
# alvo e executa somente os testes JUnit afetados via Maven Surefire.
set -euo pipefail

BASE_REF="${1:-HEAD~1}"
HEAD_REF="${2:-HEAD}"
TARGET_DIR="${3:-.}"
TOOL_JAR="${4:-$(cd "$(dirname "$0")/.." && pwd)/target/test-graph-selector-0.1.0-SNAPSHOT.jar}"

if [ ! -f "$TOOL_JAR" ]; then
  echo "erro: jar da ferramenta nao encontrado em $TOOL_JAR (rode 'mvn package' primeiro)" >&2
  exit 1
fi

# Resolve para caminho absoluto ANTES do cd abaixo — senao um TOOL_JAR relativo
# passa a ser procurado dentro de TARGET_DIR, onde nao existe.
TOOL_JAR="$(cd "$(dirname "$TOOL_JAR")" && pwd)/$(basename "$TOOL_JAR")"

# Comando do Maven a rodar no final: override via MVN_CMD (ex.: "./mvnw" se o
# projeto alvo nao tiver 'mvn' instalado globalmente, so o wrapper).
MVN_CMD="${MVN_CMD:-mvn}"

cd "$TARGET_DIR"

CHANGED_FILES="$(mktemp)"
trap 'rm -f "$CHANGED_FILES"' EXIT

git diff --name-only "$BASE_REF" "$HEAD_REF" -- '*.java' > "$CHANGED_FILES"

if [ ! -s "$CHANGED_FILES" ]; then
  echo "Nenhum arquivo .java alterado entre $BASE_REF e $HEAD_REF. Nada a testar."
  exit 0
fi

echo "Arquivos alterados:"
cat "$CHANGED_FILES"
echo

SELECTED_TESTS="$(java -jar "$TOOL_JAR" \
  --src src/main/java \
  --src src/test/java \
  --changed-files "$CHANGED_FILES" \
  --format csv)"

if [ -z "$SELECTED_TESTS" ]; then
  echo "Nenhum teste depende dos arquivos alterados."
  exit 0
fi

echo "Testes selecionados: $SELECTED_TESTS"
"$MVN_CMD" -q test -Dtest="$SELECTED_TESTS"
