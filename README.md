# test-graph-selector

Execução seletiva de testes por grafo de dependências (AST), para projetos Java/JUnit.

Dado um diff de Git, a ferramenta indexa o código-fonte via AST (JavaParser, com
resolução de símbolos — não é casamento de texto, é resolução semântica real de
chamadas de método), monta um grafo de dependências ("quem chama quem") e faz uma
travessia reversa a partir dos arquivos alterados para achar todo teste JUnit que
transitivamente depende deles. Determinístico: mesmo código-fonte → mesmo grafo,
sempre. Sem IA no núcleo.

## Por que não Bazel? 

Bazel resolve o mesmo problema (`bazel query "rdeps(...)"`, `bazel-diff`), mas parte
de um grafo *declarado* nos `BUILD` files — exige adotar o build system inteiro.
Esta ferramenta infere o grafo *direto do código-fonte* via AST, então funciona em
qualquer repo Maven/Gradle existente, sem migrar nada.

## Arquitetura

```
scripts/select-tests.sh          # CLI shell: valida Git -> diff -> seleção -> Maven (ou fallback completo)
src/main/java/.../graph/          DependencyGraph.java   # grafo dirigido (JGraphT)
src/main/java/.../index/          AstIndexer.java         # AST -> grafo (JavaParser + Symbol Solver)
src/main/java/.../select/         TestSelector.java       # travessia reversa -> testes afetados
src/main/java/.../Main.java       # CLI (picocli)
examples/sample-java-project/     # projeto Java de exemplo p/ testar o pipeline
.github/workflows/ci.yml          # demo: seletivo vs. suíte completa
```

Cada classe é um nó. Uma aresta `A -> B` significa "A chama um método de B, ou
estende/implementa B". Uma classe é marcada como teste se tem algum método anotado
com `@Test`/`@ParameterizedTest`/etc., ou se o nome termina em `Test`/`Tests`.

Para "o que muda se eu alterar X?", fazemos BFS no grafo com as arestas invertidas
a partir de X — isso dá todo nó que depende de X, direta ou indiretamente. Filtramos
esse conjunto pelos nós marcados como teste.

## Setup local

**Pré-requisito: Maven.** Neste ambiente a instalação via `choco install maven -y`
falhou por falta de shell elevado. Resolva com uma das opções:

1. PowerShell **como Administrador**: `choco install maven -y`
2. Ou baixe manualmente em https://maven.apache.org/download.cgi, extraia, e
   adicione a pasta `bin` ao PATH.
3. Ou abra este diretório no VS Code com a extensão "Extension Pack for Java"
   (inclui Maven embutido — não precisa instalar nada à parte).

Depois, confirme:

```bash
mvn -version
```

## Build e teste manual

```bash
mvn package
java -jar target/test-graph-selector-0.1.0-SNAPSHOT.jar \
  --src examples/sample-java-project/src/main/java \
  --src examples/sample-java-project/src/test/java \
  --changed-files caminho/para/arquivo-com-mudancas.txt
```

## Demo ponta a ponta (dentro do repo, usando o exemplo)

```bash
cd examples/sample-java-project
git init -q && git add -A && git commit -q -m "baseline"
# simula uma mudança em Calculator (sem tocar em Logger)
sed -i 's/a + b/a + b \/* alterado *\//' src/main/java/com/example/Calculator.java
git add -A && git commit -q -m "mudanca em Calculator"

../../scripts/select-tests.sh HEAD~1 HEAD .
# esperado: seleciona so CalculatorTest, nao LoggerTest

# inspeciona a decisao sem executar os testes
../../scripts/select-tests.sh HEAD~1 HEAD . --dry-run
```

## Limitações conhecidas

- Assume layout Maven padrão (`src/main/java`, `src/test/java`) para mapear
  caminho de arquivo → nome totalmente qualificado da classe.
- O script exige refs Git válidas, um repositório Git e `pom.xml`; tenta usar
  `mvn` e recorre a `./mvnw` quando Maven não está no PATH. Mudanças em arquivos
  não Java, remoções e renomeações acionam a suíte completa como fallback seguro.
  `--dry-run` mostra o comando Maven que seria executado sem rodá-lo.
- Chamadas via reflection, dependency injection (Spring, CDI) e interfaces
  dinâmicas não são resolvidas — o grafo fica incompleto nesses casos (falso
  negativo: um teste afetado pode não ser selecionado). Documentar isso é
  parte do entregável.
- O grafo é reconstruído do zero a cada execução. Próximo passo natural:
  serializar em JSON e cachear entre execuções de CI (só reindexar os
  arquivos que mudaram desde o último cache).

## Adaptando para outra linguagem

Só o `AstIndexer` é específico de Java (usa JavaParser). `DependencyGraph` e
`TestSelector` são agnósticos de linguagem — para TypeScript, troque o indexador
por um baseado no compilador TS (`ts-morph`) ou no `code_match` do CocoIndex, e
mantenha o resto do pipeline.
