#!/usr/bin/env bash
# prove-safety.sh: injeta um bug proposital e mostra que um teste SELECIONADO
# o pega.
#
#   demo/prove-safety.sh [typescript|java|java-gradle|python|spring]
#
# O bug fica em add()/MathUtils.add() (a + b -> a - b). Nenhum teste chama
# add() diretamente pelo teste do carrinho: ele e pego pela cadeia indireta
# teste -> Cart -> Cart.total() -> add(). Sucesso = select-tests.sh sai com 1.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LANG_NAME="${1:-typescript}"
REPO="$(setup_repo "$LANG_NAME")"

case "$LANG_NAME" in
  typescript) FILE=src/utils/math.ts ;;
  java|java-gradle) FILE=src/main/java/com/example/shop/util/MathUtils.java ;;
  python) FILE=app/utils/math.py ;;
  spring) FILE=src/main/java/com/example/shop/DefaultPriceService.java ;;
esac
if [[ "$LANG_NAME" == "spring" ]]; then
  # Bug na implementacao que o Spring injeta: so o @SpringBootTest e o teste
  # unitario da classe enxergam (os outros usam mock/lambda).
  commit_change "$REPO" "bug proposital no preco" "sed -i.bak 's/sku.length() \* 100/sku.length() * 10/' $FILE && rm $FILE.bak"
else
  commit_change "$REPO" "bug proposital em add()" "sed -i.bak 's/return a + b/return a - b/' $FILE && rm $FILE.bak"
fi

echo "== Bug injetado em $FILE:" >&2
git -C "$REPO" show --stat --format='   %s' HEAD >&2
git -C "$REPO" show HEAD -- "$FILE" | grep '^[-+] ' >&2 || true

set +e
"$SELECT_TESTS" --project "$REPO" --lang "$(demo_lang "$LANG_NAME")" --base HEAD~1 --head HEAD
code=$?
set -e

echo >&2
if [[ $code -eq 1 ]]; then
  echo "== OK: os testes selecionados FALHARAM com o bug (exit 1). A selecao nao deixou o bug passar." >&2
  exit 0
fi
echo "== FALHA DA DEMO: esperado exit 1, veio $code" >&2
exit 1
