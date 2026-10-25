# test-graph-selector

Roda **só os testes afetados** por um diff do Git e explica por que cada um foi
escolhido. Ele analisa o código (AST) e monta um grafo de dependências. Não usa
IA: a mesma entrada gera sempre a mesma saída.

Linguagens validadas: TypeScript/JavaScript (Jest), Java (JUnit com Maven ou
Gradle, incluindo Spring Boot) e Python (pytest).

## Instalação

```bash
pip install graphifyy==0.9.90        # indexador AST (Python), obrigatório
npm install -g test-graph-selector   # esta ferramenta
```

## Uso

```bash
select-tests --base origin/main --head HEAD [--project DIR] \
  [--lang typescript|java|java-gradle|python] [--dry-run] [--format text|json|md]
```

Exemplo de saída:

```text
SELETIVO: 3 de 6 testes (50% economizado)
  * tests/cart.test.ts
      tests/cart.test.ts --importa--> src/services/cart.ts --importa--> src/utils/math.ts [alterado em src/utils/math.ts]
```

Códigos de saída: `0` testes ok · `1` testes falharam · `2` erro sem como testar.
Se a ferramenta falhar, ela **roda a suíte completa**: nunca deixa de testar.

## GitHub Actions

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0                 # obrigatório: o diff precisa do histórico
- uses: actions/setup-node@v4
  with: { node-version: "20" }
- uses: actions/setup-python@v5
  with: { python-version: "3.12" }
- run: pip install graphifyy==0.9.90 && npm install -g test-graph-selector@1
- run: npm ci                      # dependências do SEU projeto
- run: select-tests --base "origin/${{ github.base_ref || 'main' }}" --head HEAD
```

O relatório aparece no Job Summary do GitHub automaticamente.

## Requisitos

Linux ou macOS com `bash` (no Windows, use o Git Bash), Git, Node.js 18+,
Python 3.10+ e o toolchain do projeto testado.

Documentação completa, regras de segurança e limites conhecidos:
https://github.com/Pedronovaesdev/test-graph
