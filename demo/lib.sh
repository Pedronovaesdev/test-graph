#!/usr/bin/env bash
# Funcoes comuns dos scripts de demonstracao (compare.sh, prove-safety.sh).
# Cada demo roda num repositorio git descartavel em demo/.work/<lang>, criado
# a partir de demo/ts-project ou demo/java-project, para poder fazer commits
# sem tocar no repositorio real.

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEMO_DIR/.." && pwd)"
SELECT_TESTS="$ROOT_DIR/select-tests.sh"

now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

project_source() {
  case "$1" in
    typescript) echo "$DEMO_DIR/ts-project" ;;
    java) echo "$DEMO_DIR/java-project" ;;
    java-gradle) echo "$DEMO_DIR/java-gradle-project" ;;
    python) echo "$DEMO_DIR/python-project" ;;
    spring) echo "$DEMO_DIR/spring-project" ;;
    *) echo "linguagem sem demo: $1" >&2; return 1 ;;
  esac
}

full_suite_command() {
  case "$1" in
    typescript) echo "npx jest --ci" ;;
    java) echo "mvn -q test" ;;
    java-gradle|spring) echo "./gradlew test --rerun --console=plain -q" ;;
    python) echo "python -m pytest -q" ;;
  esac
}

# Configuracao de linguagem (--lang) usada por cada demo.
demo_lang() {
  case "$1" in
    spring) echo "java-gradle" ;;
    *) echo "$1" ;;
  esac
}

# setup_repo <lang>: cria demo/.work/<lang> com um commit inicial e imprime o caminho.
setup_repo() {
  local lang="$1" src work
  src="$(project_source "$lang")"
  work="$DEMO_DIR/.work/$lang"
  rm -rf "$work"
  mkdir -p "$work"
  (cd "$src" && tar --exclude=node_modules --exclude=graphify-out --exclude=target --exclude=build --exclude=.gradle --exclude=__pycache__ --exclude=.pytest_cache --exclude=.selector-out -cf - .) \
    | (cd "$work" && tar -xf -)
  if [[ "$lang" == "typescript" ]]; then
    [[ -d "$src/node_modules" ]] || (cd "$src" && npm ci --silent) >&2
    ln -s "$src/node_modules" "$work/node_modules" 2>/dev/null || cp -r "$src/node_modules" "$work/node_modules"
  fi
  (
    cd "$work"
    git init -q -b main
    git config user.email demo@example.com
    git config user.name demo
    git config core.autocrlf false
    git add -A
    git commit -qm "estado inicial"
  ) >&2
  echo "$work"
}

# commit_change <repo> <mensagem> <comando que altera arquivos>
commit_change() {
  local repo="$1" msg="$2"
  shift 2
  (cd "$repo" && eval "$*" && git add -A && git commit -qm "$msg") >&2
}

# json_field <arquivo> <expr JS sobre r> [padrao se o arquivo nao existir]
json_field() {
  [[ -f "$1" ]] || { printf '%s' "${3:-?}"; return 0; }
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"
}
