#!/usr/bin/env bash
# compare.sh: suite completa vs execucao seletiva, commit a commit.
#
#   demo/compare.sh [typescript|java|java-gradle|python|spring]
#
# Cria um historico de commits no projeto demo (cada um com um tipo de
# mudanca diferente) e, para cada commit, roda a suite completa e o
# select-tests.sh contra o commit anterior, medindo tempo e testes. Imprime
# uma tabela Markdown (tambem salva em demo/.work/<lang>/compare.md).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LANG_NAME="${1:-typescript}"
REPO="$(setup_repo "$LANG_NAME")"
FULL_CMD="$(full_suite_command "$LANG_NAME")"

scenarios_typescript() {
  commit_change "$REPO" "muda add()" "sed -i.bak 's/return a + b;/return b + a;/' src/utils/math.ts && rm src/utils/math.ts.bak"
  commit_change "$REPO" "muda money()" "sed -i.bak 's#(cents / 100)#(cents / 100.0)#' src/utils/money.ts && rm src/utils/money.ts.bak"
  commit_change "$REPO" "muda User" "sed -i.bak 's/^}\$/  toString(): string {\n    return this.name;\n  }\n}/' src/services/user.ts && rm src/services/user.ts.bak"
  commit_change "$REPO" "so documentacao" "printf '# Demo\n' > README.md"
  commit_change "$REPO" "renomeia notifier.ts" "git mv src/services/notifier.ts src/services/notify.ts && sed -i.bak 's#services/notifier#services/notify#' tests/mock.test.ts && rm tests/mock.test.ts.bak"
  commit_change "$REPO" "muda package.json" "sed -i.bak 's/\"private\": true,/\"private\": true,\n  \"description\": \"demo\",/' package.json && rm package.json.bak"
}

scenarios_java() {
  local pkg=src/main/java/com/example/shop
  commit_change "$REPO" "muda MathUtils.add()" "sed -i.bak 's/return a + b;/return b + a;/' $pkg/util/MathUtils.java && rm $pkg/util/MathUtils.java.bak"
  commit_change "$REPO" "muda Money.format()" "sed -i.bak 's#cents % 100)#Math.abs(cents % 100))#' $pkg/util/Money.java && rm $pkg/util/Money.java.bak"
  commit_change "$REPO" "muda EmailNotifier (DI)" "sed -i.bak 's/+ to +/+ to.trim() +/' $pkg/EmailNotifier.java && rm $pkg/EmailNotifier.java.bak"
  commit_change "$REPO" "so documentacao" "printf '# Demo\n' > README.md"
  commit_change "$REPO" "muda pom.xml" "sed -i.bak 's#<version>0.1.0-SNAPSHOT</version>#<version>0.1.1-SNAPSHOT</version>#' pom.xml && rm pom.xml.bak"
}

# Mesmas mudancas de codigo do Maven; so o arquivo de build muda.
scenarios_java-gradle() {
  local pkg=src/main/java/com/example/shop
  commit_change "$REPO" "muda MathUtils.add()" "sed -i.bak 's/return a + b;/return b + a;/' $pkg/util/MathUtils.java && rm $pkg/util/MathUtils.java.bak"
  commit_change "$REPO" "muda Money.format()" "sed -i.bak 's#cents % 100)#Math.abs(cents % 100))#' $pkg/util/Money.java && rm $pkg/util/Money.java.bak"
  commit_change "$REPO" "muda EmailNotifier (DI)" "sed -i.bak 's/+ to +/+ to.trim() +/' $pkg/EmailNotifier.java && rm $pkg/EmailNotifier.java.bak"
  commit_change "$REPO" "so documentacao" "printf '# Demo
' > README.md"
  commit_change "$REPO" "muda build.gradle" "sed -i.bak \"s/version = '0.1.0-SNAPSHOT'/version = '0.1.1-SNAPSHOT'/\" build.gradle && rm build.gradle.bak"
}

scenarios_spring() {
  local pkg=src/main/java/com/example/shop
  commit_change "$REPO" "muda DefaultPriceService (impl. da interface)" "sed -i.bak 's/return sku.length() \* 100;/return 100 * sku.length();/' $pkg/DefaultPriceService.java && rm $pkg/DefaultPriceService.java.bak"
  commit_change "$REPO" "muda Clock (@Autowired em campo)" "sed -i.bak 's/return \"today\";/return String.valueOf(\"today\");/' $pkg/Clock.java && rm $pkg/Clock.java.bak"
  commit_change "$REPO" "muda CartController" "sed -i.bak 's/return cart.total(sku, quantity);/return cart.total(sku, Math.max(quantity, 0));/' $pkg/CartController.java && rm $pkg/CartController.java.bak"
  commit_change "$REPO" "muda so um teste" "sed -i.bak 's/PriceService fixed = sku -> 250;/PriceService fixed = s -> 250;/' src/test/java/com/example/shop/CartServiceTest.java && rm src/test/java/com/example/shop/CartServiceTest.java.bak"
  commit_change "$REPO" "so documentacao" "printf '# Demo
' > README.md"
  commit_change "$REPO" "muda application.properties" "printf 'server.port=8081
' >> src/main/resources/application.properties"
}

scenarios_python() {
  commit_change "$REPO" "muda add()" "sed -i.bak 's/return a + b/return b + a/' app/utils/math.py && rm app/utils/math.py.bak"
  commit_change "$REPO" "muda money()" "sed -i.bak 's#cents / 100#cents / 100.0#' app/utils/money.py && rm app/utils/money.py.bak"
  commit_change "$REPO" "muda Cart (fixture do conftest)" "sed -i.bak 's/result = 0/result: int = 0/' app/services/cart.py && rm app/services/cart.py.bak"
  commit_change "$REPO" "muda User" "printf '
    def __repr__(self) -> str:
        return self.name
' >> app/services/user.py"
  commit_change "$REPO" "so documentacao" "printf '# Demo
' > README.md"
  commit_change "$REPO" "muda pyproject.toml" "sed -i.bak 's/version = \"1.0.0\"/version = \"1.0.1\"/' pyproject.toml && rm pyproject.toml.bak"
}

"scenarios_$LANG_NAME"

COMMITS=()
while IFS= read -r line; do COMMITS+=("$line"); done < <(git -C "$REPO" rev-list --reverse HEAD | tail -n +2)

# Aquece caches (ts-jest / maven) para nao penalizar a primeira linha.
(cd "$REPO" && eval "$FULL_CMD" >/dev/null 2>&1) || true

TABLE="$REPO/compare.md"
{
  echo "## Suite completa vs seletiva ($LANG_NAME)"
  echo
  echo "| Commit | Modo | Testes (seletivo / total) | Tempo completo | Tempo seletivo | Regras |"
  echo "|---|---|---|---|---|---|"
} > "$TABLE"

TOTAL_FULL=0
TOTAL_SEL=0
for sha in "${COMMITS[@]}"; do
  git -C "$REPO" checkout -q "$sha"
  msg="$(git -C "$REPO" log -1 --format=%s)"
  echo ">>> $msg" >&2

  rm -rf "$REPO/.selector-out"
  t0="$(now_ms)"
  (cd "$REPO" && eval "$FULL_CMD" >/dev/null 2>&1) || echo "    (suite completa falhou)" >&2
  t1="$(now_ms)"
  "$SELECT_TESTS" --project "$REPO" --lang "$(demo_lang "$LANG_NAME")" --base "$sha~1" --head "$sha" >"$REPO/.selector-out.log" 2>&1 \
    || echo "    (selecao/testes falharam; ver $REPO/.selector-out.log)" >&2
  t2="$(now_ms)"

  report="$REPO/.selector-out/report.json"
  mode="$(json_field "$report" r.mode fail-safe)"
  sel="$(json_field "$report" r.summary.selected)"
  total="$(json_field "$report" r.summary.total)"
  rules="$(json_field "$report" 'Object.keys(r.rules_triggered).join(", ")')"
  full_s="$(( (t1 - t0) / 1000 )).$(( (t1 - t0) % 1000 / 100 ))s"
  sel_s="$(( (t2 - t1) / 1000 )).$(( (t2 - t1) % 1000 / 100 ))s"
  TOTAL_FULL=$((TOTAL_FULL + t1 - t0))
  TOTAL_SEL=$((TOTAL_SEL + t2 - t1))
  echo "| $msg | $mode | $sel / $total | $full_s | $sel_s | $rules |" >> "$TABLE"
done

{
  echo
  echo "Total: completo $((TOTAL_FULL / 1000))s, seletivo $((TOTAL_SEL / 1000))s (o seletivo inclui indexacao AST + selecao)."
} >> "$TABLE"

git -C "$REPO" checkout -q main
cat "$TABLE"
