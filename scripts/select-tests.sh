#!/usr/bin/env bash
# Uso: scripts/select-tests.sh <base_ref> <head_ref> <dir_do_projeto_alvo> [caminho_do_jar] [--dry-run]
set -euo pipefail

BASE_REF="${1:-HEAD~1}"
HEAD_REF="${2:-HEAD}"
TARGET_DIR="${3:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_JAR="$SCRIPT_DIR/../target/test-graph-selector-0.1.0-SNAPSHOT.jar"
DRY_RUN=false

if [ "$#" -ge 4 ]; then
  for arg in "${@:4}"; do
    if [ "$arg" = "--dry-run" ]; then
      DRY_RUN=true
    elif [ -n "$arg" ]; then
      TOOL_JAR="$arg"
    fi
  done
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "erro: diretorio alvo nao encontrado: $TARGET_DIR" >&2
  exit 2
fi
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
if ! git -C "$TARGET_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "erro: diretorio alvo nao pertence a um repositorio Git: $TARGET_DIR" >&2
  exit 2
fi
for ref in "$BASE_REF" "$HEAD_REF"; do
  if ! git -C "$TARGET_DIR" rev-parse --verify "${ref}^{commit}" >/dev/null 2>&1; then
    echo "erro: referencia Git invalida ou nao resolvida: $ref" >&2
    exit 2
  fi
done
if [ ! -f "$TARGET_DIR/pom.xml" ]; then
  echo "erro: pom.xml nao encontrado em $TARGET_DIR; este fluxo requer um projeto Maven" >&2
  exit 2
fi

# Resolva o jar antes de mudar para o diretório do projeto alvo.
if [ ! -f "$TOOL_JAR" ]; then
  echo "erro: jar da ferramenta nao encontrado em $TOOL_JAR (rode 'mvn package' primeiro)" >&2
  exit 2
fi
TOOL_JAR="$(cd "$(dirname "$TOOL_JAR")" && pwd)/$(basename "$TOOL_JAR")"

MVN_CMD="${MVN_CMD:-mvn}"
if ! command -v "$MVN_CMD" >/dev/null 2>&1; then
  if [ -x "$TARGET_DIR/mvnw" ]; then
    MVN_CMD="$TARGET_DIR/mvnw"
  else
    echo "erro: Maven indisponivel e wrapper executavel nao encontrado em $TARGET_DIR/mvnw" >&2
    exit 2
  fi
fi

CHANGED_FILES="$(mktemp)"
trap 'rm -f "$CHANGED_FILES"' EXIT
if ! git -C "$TARGET_DIR" diff --name-status -z "$BASE_REF" "$HEAD_REF" > "$CHANGED_FILES"; then
  echo "erro: nao foi possivel calcular o diff entre $BASE_REF e $HEAD_REF" >&2
  exit 2
fi

if [ ! -s "$CHANGED_FILES" ]; then
  echo "Nenhuma mudanca entre $BASE_REF e $HEAD_REF. Nada a testar."
  exit 0
fi

FULL_SUITE=false
CHANGED_JAVA="$(mktemp)"
trap 'rm -f "$CHANGED_FILES" "$CHANGED_JAVA"' EXIT
while IFS= read -r -d '' status; do
  IFS= read -r -d '' first_path || break
  case "$status" in
    R*|C*)
      IFS= read -r -d '' second_path || second_path=""
      echo "$status: $first_path -> $second_path"
      # Renames/copies can remove edges from the current source tree; use a safe fallback.
      FULL_SUITE=true
      ;;
    D*)
      echo "$status: $first_path"
      # A deleted type is absent from the indexed tree, so impact cannot be resolved safely.
      FULL_SUITE=true
      ;;
    *)
      echo "$status: $first_path"
      if [[ "$first_path" == *.java ]]; then
        printf '%s\n' "$first_path" >> "$CHANGED_JAVA"
      else
        FULL_SUITE=true
      fi
      ;;
  esac
done < "$CHANGED_FILES"

if [ "$FULL_SUITE" = true ]; then
  echo "Mudanca estrutural/global detectada; fallback para a suite Maven completa."
  if [ "$DRY_RUN" = true ]; then
    echo "dry-run: $MVN_CMD -q test"
    exit 0
  fi
  cd "$TARGET_DIR"
  exec "$MVN_CMD" -q test
fi

if [ ! -s "$CHANGED_JAVA" ]; then
  echo "Nenhuma mudanca Java relevante. Nada a testar."
  exit 0
fi

SELECTED_TESTS="$(java -jar "$TOOL_JAR" \
  --src "$TARGET_DIR/src/main/java" \
  --src "$TARGET_DIR/src/test/java" \
  --changed-files "$CHANGED_JAVA" \
  --format csv)"

if [ -z "$SELECTED_TESTS" ]; then
  echo "Nenhum teste depende dos arquivos alterados."
  exit 0
fi

echo "Testes selecionados: $SELECTED_TESTS"
if [ "$DRY_RUN" = true ]; then
  echo "dry-run: $MVN_CMD -q test -Dtest=$SELECTED_TESTS"
  exit 0
fi
cd "$TARGET_DIR"
exec "$MVN_CMD" -q test "-Dtest=$SELECTED_TESTS"
