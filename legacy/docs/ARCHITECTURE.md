# Arquitetura — explicação completa, arquivo por arquivo

Este documento existe pra você conseguir olhar qualquer arquivo do repositório
e entender não só *o que* ele faz, mas *por que* foi escrito daquele jeito.
Presumo que você sabe programar, mas não presumo que você já viu AST, grafos
dirigidos, ou CI/CD antes — cada conceito é explicado na primeira vez que
aparece.

## Mapa mental antes de entrar no código

O projeto resolve um problema com quatro etapas, sempre nesta ordem:

```
1. DESCOBRIR O QUE MUDOU     (git diff)
        │
        ▼
2. ENTENDER O PROJETO INTEIRO (ler todo o código-fonte e montar um "mapa de
        │                      quem depende de quem" — o grafo)
        ▼
3. PERGUNTAR AO MAPA          (partindo do que mudou, quem é afetado?)
        │
        ▼
4. RODAR SÓ O QUE FOI AFETADO (mvn test / pytest / jest, com uma lista curta)
```

As etapas 1 e 4 mudam de ferramenta dependendo da linguagem do projeto que
você está analisando (`git diff` é sempre igual, mas `mvn test`, `pytest` e
`jest` são comandos diferentes). As etapas 2 e 3 são o coração do projeto, e
foram desenhadas para funcionar **igual**, não importa a linguagem — é por
isso que existe uma peça central em Java (o "motor") que todo o resto
alimenta.

```
                         ┌─────────────────────────┐
   Java  ────(direto)───▶│                         │
                         │   MOTOR (Java):          │──▶ testes selecionados
   Python ──(via JSON)──▶│   DependencyGraph +      │
                         │   TestSelector           │
   Node  ──(via JSON)───▶│                         │
                         └─────────────────────────┘
```

Guarda essa imagem — todo o resto deste documento é detalhar cada uma dessas
caixas.

---

## Índice

1. [`pom.xml`](#pomxml--a-receita-do-projeto-java)
2. [`src/main/java/.../graph/DependencyGraph.java`](#dependencygraphjava--o-mapa)
3. [`src/main/java/.../graph/GraphJsonCodec.java`](#graphjsoncodecjava--lendo-mapas-de-fora)
4. [`src/main/java/.../index/AstIndexer.java`](#astindexerjava--desenhando-o-mapa-pro-java)
5. [`src/main/java/.../select/TestSelector.java`](#testselectorjava--a-pergunta-que-importa)
6. [`src/main/java/.../Main.java`](#mainjava--a-porta-de-entrada)
7. [`extractors/python/extract_graph.py`](#extract_graphpy--desenhando-o-mapa-pro-python)
8. [`extractors/node/extract-graph.mjs`](#extract-graphmjs--desenhando-o-mapa-pro-node)
9. [`scripts/select-tests*.sh`](#scriptsselect-testssh--a-cola-de-tudo)
10. [`.github/workflows/ci.yml`](#githubworkflowsciyml--rodando-isso-tudo-sozinho)
11. [Glossário rápido](#glossário-rápido)

---

## `pom.xml` — a receita do projeto Java

Se você nunca usou Maven: pense nele como o `package.json` do mundo Java.
`pom.xml` declara três coisas — quem seu projeto é, do que ele depende, e como
ele é construído (compilado, empacotado).

```xml
<groupId>com.levelup.testgraph</groupId>
<artifactId>test-graph-selector</artifactId>
<version>0.1.0-SNAPSHOT</version>
```

Isso é só o "nome completo" do projeto (convenção Java: `groupId` costuma ser
o domínio invertido de quem mantém o projeto — usei `com.levelup` pela sua
turma no LevelUp).

### As dependências, e por que cada uma está aqui

```xml
<dependency>
  <groupId>com.github.javaparser</groupId>
  <artifactId>javaparser-symbol-solver-core</artifactId>
</dependency>
```
O parser que lê código Java e entende sua estrutura — **e** resolve chamadas
de método pra saber exatamente qual classe/método está sendo chamado (não só
"tem essa forma de chamada"). É o coração do [`AstIndexer.java`](#astindexerjava--desenhando-o-mapa-pro-java).

```xml
<dependency>
  <groupId>org.jgrapht</groupId>
  <artifactId>jgrapht-core</artifactId>
</dependency>
```
Uma biblioteca só de estruturas de grafo (nós, arestas, buscas). Evita
reinventar um BFS na mão com bugs. É o motor por trás do
[`DependencyGraph.java`](#dependencygraphjava--o-mapa).

```xml
<dependency>
  <groupId>info.picocli</groupId>
  <artifactId>picocli</artifactId>
</dependency>
```
Framework de CLI: transforma `--src foo --format csv` em campos Java
populados automaticamente, com `--help` de graça. Usado só em
[`Main.java`](#mainjava--a-porta-de-entrada).

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```
Le/escreve JSON. É como o [`GraphJsonCodec.java`](#graphjsoncodecjava--lendo-mapas-de-fora)
entende o arquivo que o extrator Python/Node produziu.

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <scope>test</scope>
</dependency>
```
JUnit — mas repare no `<scope>test</scope>`: isso diz "só precisa disso pra
*rodar meus próprios testes*, não precisa ir dentro do programa final". Sem
esse escopo, o JUnit inteiro iria parar dentro do `.jar` publicado à toa.

### O plugin que gera o "jar gordo"

```xml
<plugin>
  <artifactId>maven-shade-plugin</artifactId>
  ...
  <mainClass>com.levelup.testgraph.Main</mainClass>
</plugin>
```

Por padrão, `mvn package` gera um `.jar` que **só** tem o seu código — se
alguém tentar `java -jar` nele, vai dar erro de "classe não encontrada"
assim que o programa tentar usar o JavaParser, porque o JavaParser não está
dentro do jar. O `maven-shade-plugin` resolve isso: pega seu código + o
código de **todas** as dependências e empacota tudo junto num único arquivo
(por isso "jar gordo"/"fat jar"). É esse jar de ~8,5MB que vira o artefato
distribuível — a peça que discutimos que a "empresa" só baixa via GitHub
Release, sem precisar clonar nada.

---

## `DependencyGraph.java` — o mapa

```java
private final Graph<String, DefaultEdge> graph = new SimpleDirectedGraph<>(DefaultEdge.class);
private final Set<String> testNodes = new HashSet<>();
```

Duas estruturas de dados, só isso:
- Um **grafo dirigido** (`Graph<String, DefaultEdge>`): cada nó é uma `String`
  (nome de classe Java, ou caminho de arquivo — o motor não se importa qual).
  "Dirigido" quer dizer que a aresta `A → B` é diferente de `B → A` — importante
  porque "A chama B" não é o mesmo que "B chama A".
- Um **conjunto de nós que são teste** (`testNodes`) — guardado à parte, porque
  nem todo nó do grafo é um teste, e precisamos saber quais são na hora de
  filtrar a resposta final.

### A parte que faz mágica: `ancestorsOf`

```java
public Set<String> ancestorsOf(String start) {
    if (!graph.containsVertex(start)) {
        return Set.of();
    }
    Graph<String, DefaultEdge> reversed = new EdgeReversedGraph<>(graph);
    Set<String> result = new LinkedHashSet<>();
    Iterator<String> it = new BreadthFirstIterator<>(reversed, start);
    if (it.hasNext()) {
        it.next(); // descarta o proprio start
    }
    it.forEachRemaining(result::add);
    return result;
}
```

Passo a passo:

1. **`EdgeReversedGraph`** — não modifica o grafo original, só cria uma "lente"
   que inverte toda aresta na hora de ler (se o grafo real tem `A → B`, essa
   lente mostra `B → A`). Isso é O(1), não copia o grafo inteiro.
2. **`BreadthFirstIterator`** — faz uma **busca em largura (BFS)**: começa em
   `start`, visita todos os vizinhos diretos, depois os vizinhos dos vizinhos,
   e assim por diante, até esgotar tudo que é alcançável.
3. Combinando os dois: andar em BFS **no grafo invertido** a partir de `start`
   é exatamente andar "contra a seta" no grafo original — ou seja, achar todo
   nó que, direta ou indiretamente, **aponta para** `start`.

Se `CalculatorTest → Calculator` é uma aresta real (CalculatorTest depende de
Calculator), então `ancestorsOf("Calculator")` devolve `{CalculatorTest}` —
"quem depende de Calculator". Essa é a pergunta central do projeto inteiro,
resolvida em 10 linhas porque o JGraphT já tem BFS e grafo invertido prontos.

**Por que BFS e não DFS (busca em profundidade)?** Pra este problema, tanto
faz — as duas acham o mesmo conjunto de nós alcançáveis, só em ordem
diferente. BFS foi escolhido porque o JGraphT já oferece pronto e o código
fica mais legível; não há vantagem de performance relevante aqui (o grafo de
um projeto de teste é pequeno perto do que justificaria otimizar isso).

---

## `GraphJsonCodec.java` — lendo mapas de fora

```java
public static DependencyGraph load(Path jsonFile) throws IOException {
    ObjectMapper mapper = new ObjectMapper();
    GraphFile parsed = mapper.readValue(jsonFile.toFile(), GraphFile.class);
    ...
}
```

`ObjectMapper` é a classe do Jackson que faz a mágica de "ler texto JSON e
transformar em objetos Java". `readValue(arquivo, GraphFile.class)` diz: "leia
esse arquivo, e a forma dele deve bater com a classe `GraphFile`".

```java
record GraphFile(List<NodeEntry> nodes, List<EdgeEntry> edges) {}
record NodeEntry(String id, boolean isTest) {}
record EdgeEntry(String from, String to) {}
```

**O que é um `record`?** É uma forma curta do Java (desde a versão 16) de
declarar uma classe que só guarda dados, sem lógica. `record NodeEntry(String
id, boolean isTest)` já gera sozinho o construtor, os getters (`id()`,
`isTest()`), `equals`, `hashCode` e `toString` — sem você escrever nada disso
na mão. O Jackson consegue casar os campos do JSON (`"id"`, `"isTest"`) com
esses nomes automaticamente, por reflexão.

Depois de ler, o método só percorre as listas e chama os métodos que você já
conhece do `DependencyGraph` (`addNode`, `markAsTest`, `addEdge`) — ou seja,
esse arquivo não sabe nada de grafo, só sabe transformar JSON em chamadas de
método. É deliberadamente burro — toda a lógica interessante já está no
`DependencyGraph`.

---

## `AstIndexer.java` — desenhando o mapa pro Java

Este é o arquivo mais denso do projeto. Ele faz uma coisa: ler arquivos
`.java` de verdade e descobrir as arestas do grafo (quem chama quem).

### O que é uma AST, de verdade

Quando você escreve:
```java
int total = a + b;
```
Pro compilador, isso não é uma linha de texto — é uma **árvore**:

```
        =
       / \
   total   +
          / \
         a   b
```

**AST** = Abstract Syntax Tree, "árvore de sintaxe abstrata". É assim que
todo compilador/interpretador enxerga seu código internamente — não como
texto, como uma estrutura de dados navegável. `StaticJavaParser.parse(file)`
transforma o texto do seu `.java` nessa árvore (chamada de `CompilationUnit`
no JavaParser).

### O "Symbol Solver" — a parte que diferencia de um grep

```java
CombinedTypeSolver typeSolver = new CombinedTypeSolver(new ReflectionTypeSolver());
for (Path root : sourceRoots) {
    typeSolver.add(new JavaParserTypeSolver(root));
}
JavaSymbolSolver symbolSolver = new JavaSymbolSolver(typeSolver);
```

Uma AST sozinha só te diz "aqui tem uma chamada de método chamada `add`". Ela
**não sabe** de qual classe é esse `add` — pode haver 5 classes diferentes com
um método `add`. O Symbol Solver resolve isso: ele entende tipos, herança,
overloads, e consegue responder "este `add()` específico, chamado aqui, é o
método declarado na classe `Calculator`".

- `ReflectionTypeSolver` — sabe resolver tipos da própria biblioteca padrão do
  Java (`String`, `List`, etc.), usando reflection do próprio JVM em que o
  programa está rodando.
- `JavaParserTypeSolver` — sabe resolver tipos definidos **no seu projeto**,
  lendo os `.java` da pasta que você apontar.
- `CombinedTypeSolver` — junta os dois: tenta um, se não achar tenta o outro.

Essa é exatamente a diferença que discutimos entre esta ferramenta e o
`code_match` do CocoIndex: `code_match` só vê a forma sintática (como um
`grep` inteligente); o Symbol Solver resolve **semanticamente**, sabendo de
verdade qual declaração está sendo referenciada.

### Percorrendo a árvore

```java
cu.findAll(ClassOrInterfaceDeclaration.class).forEach(type -> {
    String typeName = type.getFullyQualifiedName().orElse(null);
    ...
    graph.addNode(typeName);

    boolean isTest = type.getMethods().stream().anyMatch(this::isTestMethod)
            || typeName.endsWith("Test") || typeName.endsWith("Tests");
    if (isTest) {
        graph.markAsTest(typeName);
    }
    ...
});
```

`cu.findAll(ClassOrInterfaceDeclaration.class)` varre a árvore inteira e
devolve toda declaração de classe/interface encontrada naquele arquivo
(normalmente uma, mas um arquivo pode ter classes aninhadas). Pra cada uma:

1. Pega o nome totalmente qualificado (`com.example.Calculator` — pacote +
   nome da classe). Isso vira o **ID do nó** no grafo.
2. Decide se é um nó de teste, checando se algum método tem `@Test` (ou
   variantes como `@ParameterizedTest`), OU se o nome da classe termina em
   `Test`/`Tests` (rede de segurança pra convenções de nomenclatura sem
   depender só da anotação).

```java
type.findAll(MethodCallExpr.class).forEach(call -> resolveSafely(call::resolve)
        .ifPresent((ResolvedMethodDeclaration resolved) -> {
            String callee = resolved.declaringType().getQualifiedName();
            graph.addEdge(typeName, callee);
        }));
```

Pra cada chamada de método (`MethodCallExpr`) dentro da classe: tenta
resolver (`call.resolve()`) pra descobrir a classe **dona** do método
chamado (`resolved.declaringType().getQualifiedName()`), e adiciona a aresta
"esta classe → aquela classe" no grafo.

### `resolveSafely` — por que existe

```java
private <T> Optional<T> resolveSafely(Supplier<T> resolver) {
    try {
        return Optional.of(resolver.get());
    } catch (RuntimeException e) {
        return Optional.empty();
    }
}
```

`call.resolve()` **lança uma exception** sempre que não consegue resolver —
o que é super comum e esperado (uma chamada pra uma biblioteca externa cujo
`.jar` não foi indexado, por exemplo). Sem esse `try/catch`, o programa
pararia inteiro na primeira chamada não-resolvível. Com ele, perdemos só
*aquela aresta específica* — o grafo fica um pouco incompleto ali, mas o
programa continua. É a mesma filosofia do `resolveSafely` do Python
(`except (SyntaxError, UnicodeDecodeError)`) e do `try/catch` no Node — falhar
localmente, não globalmente.

**Padrão de projeto usado aqui:** isso se chama genericamente de "recuperação
de erro local" ou, no estilo funcional, transformar uma operação que pode
falhar em um `Optional` (Java) — em vez de deixar a exceção estourar, você
representa explicitamente "pode ou não ter dado certo" no tipo de retorno, e
quem chama decide o que fazer (aqui: `.ifPresent(...)`, ou seja, "se deu
certo, faça algo; se não, simplesmente ignore").

---

## `TestSelector.java` — a pergunta que importa

```java
public List<Selection> select(DependencyGraph graph, Set<String> changedNodes) {
    List<Selection> selections = new ArrayList<>();
    Set<String> alreadySelected = new LinkedHashSet<>();

    for (String changed : changedNodes) {
        if (!graph.contains(changed)) {
            continue;
        }
        if (graph.testNodes().contains(changed) && alreadySelected.add(changed)) {
            selections.add(new Selection(changed, changed));
        }
        for (String ancestor : graph.ancestorsOf(changed)) {
            if (graph.testNodes().contains(ancestor) && alreadySelected.add(ancestor)) {
                selections.add(new Selection(ancestor, changed));
            }
        }
    }
    return selections;
}
```

Três casos, nesta ordem de leitura:

1. **`!graph.contains(changed)`** — o arquivo que mudou nem é um nó
   conhecido do grafo (ex.: você mudou o `README.md`, ou um `.java` que não
   tem nenhuma classe pública). Pula, sem erro.
2. **O próprio arquivo alterado é um teste** — se você editou o teste
   diretamente, ele mesmo entra na lista (`new Selection(changed, changed)`
   — o "motivo" da seleção é ele mesmo).
3. **Um ancestral do arquivo alterado é um teste** — aqui entra o
   `ancestorsOf` que vimos no `DependencyGraph`. Cada ancestral que for um
   nó de teste vira uma seleção, guardando **qual mudança causou essa
   seleção** (`s.changedNode()`) — é isso que dá a explicação "depende de
   X" que aparece no `Main.java`.

`alreadySelected` existe pra não repetir o mesmo teste duas vezes se ele
depender de *dois* arquivos alterados diferentes — sem isso, `mvn test
-Dtest=Foo,Foo` não quebraria nada, mas é redundante e feio.

**`record Selection(String test, String changedNode)`** — de novo um
`record`, só pra carregar dois valores relacionados (o teste escolhido, e o
porquê) sem precisar de uma classe cheia de boilerplate.

---

## `Main.java` — a porta de entrada

Este arquivo faz três coisas: interpreta os argumentos da linha de comando,
decide qual "fonte de grafo" usar, e formata a saída.

### Os dois modos, e por que são mutuamente exclusivos

```java
boolean hasSrc = sourceRoots != null && !sourceRoots.isEmpty();
boolean hasJson = graphJsonPath != null;

if (hasSrc == hasJson) {
    System.err.println("erro: forneca exatamente um entre --src (um ou mais) e --graph-json.");
    return 1;
}
```

`hasSrc == hasJson` é verdadeiro em dois casos: **nenhum dos dois** foi
passado (`false == false`), ou **os dois** foram passados (`true == true`).
Em ambos os casos é um uso incorreto do programa — ou você indexa Java
direto, ou você dá um grafo já pronto, nunca as duas coisas ao mesmo tempo
(seria ambíguo: qual grafo vale?). Essa checagem existe pra falhar rápido e
com uma mensagem clara, em vez de um comportamento estranho mais adiante.

```java
DependencyGraph graph = hasJson
        ? GraphJsonCodec.load(graphJsonPath)
        : new AstIndexer().index(sourceRoots);
```

Um operador ternário (`condição ? valorSeVerdadeiro : valorSeFalso`) escolhe
a fonte do grafo. Repare que **a partir daqui**, o resto do método
(`readChangedNodes`, `TestSelector().select(...)`, a formatação) não sabe
nem se importa se o grafo veio de Java ou de um JSON externo — é exatamente
o desacoplamento que projetamos.

### Por que a conversão de "arquivo mudou" pra "nó do grafo" é diferente nos dois modos

```java
Set<String> changedNodes = hasJson
        ? readChangedPaths(changedFilesPath)
        : readChangedJavaTypes(changedFilesPath);
```

- **Modo Java**: o grafo usa nomes de classe (`com.example.Calculator`) como
  ID de nó, então precisamos *traduzir* o caminho de arquivo
  (`src/main/java/com/example/Calculator.java`) pra esse formato —
  é isso que `pathToFqcn` faz (remove o prefixo `src/main/java/` ou
  `src/test/java/`, troca `/` por `.`, remove `.java`).
- **Modo JSON**: os extratores de Python/Node já usam o **caminho do
  arquivo, sem alteração**, como ID do nó (decisão de design documentada em
  `docs/graph-schema.md`) — então não precisa traduzir nada, só normalizar
  barras invertidas do Windows (`\`) pra barras normais (`/`), já que
  `git diff` no Windows às vezes devolve caminhos com `\`.

### A saída: `human` vs `csv`

```java
if ("csv".equals(format)) {
    String csv = selections.stream()
            .map(TestSelector.Selection::test)
            .distinct()
            .collect(Collectors.joining(","));
    System.out.println(csv);
    return 0;
}
```

`--format csv` existe só pra facilitar a vida de quem **consome** a saída
programaticamente (os scripts de shell) — uma lista `Foo,Bar,Baz` que já
entra direto num `-Dtest=Foo,Bar,Baz` do Maven, ou vira `Foo Bar Baz` (via
`tr ',' ' '`) pros argumentos de linha de comando do pytest/Jest. O formato
`human` (padrão) é pra quando **você** roda o jar manualmente e quer ler com
os próprios olhos, com a explicação de cada seleção.

`Main::main` (o método estático que a JVM chama primeiro) é só:
```java
public static void main(String[] args) {
    System.exit(new CommandLine(new Main()).execute(args));
}
```
Isso entrega o trabalho pro `picocli`: ele lê `args`, preenche os campos
anotados com `@Option` na própria instância de `Main`, e chama `call()`
(o método que já vimos) — é por isso que `Main implements Callable<Integer>`
(o `Integer` retornado vira o código de saída do processo).

---

## `extract_graph.py` — desenhando o mapa pro Python

Mesma missão do `AstIndexer.java` (ler código-fonte, montar arestas), mas
usando o módulo `ast` que já vem embutido no Python — não precisa instalar
nada.

### Por que este fica em nível de arquivo, não de função

Em Java, `call.resolve()` sabe dizer com certeza "este `add()` é o método da
classe `Calculator`", porque o compilador Java exige que cada variável tenha
um tipo declarado (ou inferido com certeza). Em Python:

```python
def process(thing):
    thing.add(1)  # thing.add() de QUAL classe? Impossível saber sem rodar o código.
```

`thing` pode ser literalmente qualquer objeto que tenha um método `add` —
Python não obriga você a declarar o tipo. Tentar montar um grafo de
*chamadas* aqui, de forma confiável e sem executar o código, é uma aposta
perdida. Por isso este extrator fica no nível de **import**: "este arquivo
importa aquele módulo" é uma pergunta que dá pra responder com certeza,
olhando só o texto.

### Construindo o índice de módulos

```python
def build_module_index(files: list[Path], repo_root: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    for file in files:
        rel = to_relpath(file, repo_root)
        no_ext = rel[:-3]  # remove ".py"
        if no_ext.endswith("/__init__"):
            dotted = no_ext[: -len("/__init__")].replace("/", ".")
        else:
            dotted = no_ext.replace("/", ".")
        index[dotted] = rel
    return index
```

Em Python, um import como `from app.services import calculator` se refere ao
arquivo `app/services/calculator.py` — mas o texto do import usa pontos
(`app.services.calculator`), enquanto o sistema de arquivos usa barras
(`app/services/calculator.py`). Esta função cria um dicionário que traduz de
um formato pro outro, pra **todo** arquivo do projeto, uma vez só, no início
— assim, resolver um import vira só uma consulta no dicionário (`O(1)`), em
vez de procurar no disco toda vez.

O caso de `__init__.py` merece atenção: `app/services/__init__.py`
representa o **pacote** `app.services` (não `app.services.__init__`) — é
assim que o próprio Python interpreta esse arquivo especial, e o código
replica essa regra.

### Resolvendo imports relativos

```python
if node.level and node.level > 0:
    up = node.level - 1
    base_parts = dir_parts[: len(dir_parts) - up] if up <= len(dir_parts) else []
    if node.module:
        base_parts = base_parts + node.module.split(".")
```

`from . import x` e `from .. import y` são "imports relativos" — relativos à
localização do próprio arquivo, não ao topo do projeto. O `ast` do Python
representa isso com `node.level` (quantidade de pontos: 1 pra `.`, 2 pra
`..`, etc.). Esse trecho calcula, a partir da pasta onde o arquivo atual
está (`dir_parts`), qual pasta o import relativo está de fato apontando —
subindo `up` níveis (`level - 1`, porque um único ponto já significa "aqui
mesmo", sem subir nenhum nível).

### `ast.walk` — percorrendo a árvore sem se preocupar com a estrutura

```python
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        edges |= resolve_plain_import(node, module_index)
    elif isinstance(node, ast.ImportFrom):
        edges |= resolve_from_import(node, relpath, module_index)
```

`ast.walk` visita **todo** nó da árvore, não importa a profundidade (dentro
de uma função, dentro de um `if`, dentro de uma classe — não importa).
`isinstance` checa o tipo de cada nó visitado. É o equivalente Python do
`cu.findAll(...)` do JavaParser — a mesma ideia (percorrer a árvore
procurando um tipo específico de nó), com uma API um pouco diferente.

---

## `extract-graph.mjs` — desenhando o mapa pro Node

Mesma missão de novo, agora para TypeScript/JavaScript, usando `ts-morph` —
uma biblioteca que embrulha o **compilador de verdade do TypeScript** (o
mesmo `tsc` que você já usa) numa API mais fácil de programar contra.

### Por que TypeScript poderia ter call graph, mas não tem aqui

TypeScript **é** tipado estaticamente (quando você usa tipos, que é o caso
comum) — então, diferente do Python, daria pra usar o *type checker* do
`ts-morph` pra resolver chamadas de método com precisão, igual ao Java. Não
fizemos isso aqui por decisão de escopo: manter a mesma granularidade
(arquivo/import) que o Python deixa a "história" de multi-linguagem mais
simples de explicar e mais rápida de implementar. Fica documentado como
próximo passo natural no README.

### Descobrindo os arquivos do projeto

```js
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true },
});
project.addSourceFilesAtPaths([
  `${repoRoot}/**/*.{ts,tsx,js,jsx}`,
  `!${repoRoot}/**/node_modules/**`,
  ...
]);
```

`Project` é o objeto principal do `ts-morph` — representa "um projeto
TypeScript inteiro carregado na memória". `addSourceFilesAtPaths` aceita
padrões glob (`**/*.ts` = "qualquer `.ts`, em qualquer subpasta"), incluindo
padrões de exclusão prefixados com `!`. `allowJs: true` diz pro compilador
"aceite arquivos `.js` também, não só `.ts`" — sem isso, arquivos JavaScript
puros seriam ignorados.

### A parte que resolve o import de verdade

```js
const targetFile = decl.getModuleSpecifierSourceFile();
if (!targetFile) continue;
const targetRel = toPosixRelative(repoRoot, targetFile.getFilePath());
```

`decl` é uma declaração de import (`import { add } from './calculator'`).
`getModuleSpecifierSourceFile()` é o `ts-morph` fazendo o trabalho pesado:
pega a string `'./calculator'`, aplica as mesmas regras que o `tsc` usa pra
descobrir a que arquivo isso se refere (resolvendo `.ts` vs `.tsx`, index
files, etc.), e devolve o objeto do arquivo real — ou `undefined` se for um
pacote externo (`react`, `lodash`) que não faz parte do seu código-fonte
local. É o mesmo espírito do `resolveSafely` do Java: se não resolver
(`!targetFile`), simplesmente pula (`continue`), sem quebrar o programa.

Isso é estritamente mais confiável do que tentar resolver o caminho na mão
com `path.resolve` — o `ts-morph` já lida com todas as regras especiais de
resolução de módulo do Node/TypeScript que você não ia querer reimplementar.

---

## `scripts/select-tests*.sh` — a cola de tudo

Os três scripts (`select-tests.sh`, `select-tests-python.sh`,
`select-tests-node.sh`) seguem exatamente a mesma receita, só trocando a
ferramenta de extração e o runner de teste no final. Vamos usar o de Python
como exemplo, porque ele mostra o caso mais completo (usa `--graph-json`,
diferente do Java que indexa direto).

```bash
set -euo pipefail
```
Três comportamentos de segurança do Bash, sempre juntos por convenção:
- `-e`: para o script imediatamente se qualquer comando falhar (sem isso, um
  `git diff` que falha silenciosamente deixaria o script continuar com dados
  errados).
- `-u`: trata uso de variável não definida como erro (pega erros de
  digitação em nomes de variável).
- `-o pipefail`: numa pipeline (`a | b`), considera falha se **qualquer**
  parte falhar, não só a última — sem isso, `comando_que_falha | cat` seria
  considerado sucesso, porque `cat` não falhou.

```bash
TOOL_JAR="$(cd "$(dirname "$TOOL_JAR")" && pwd)/$(basename "$TOOL_JAR")"
```
Esta linha resolve o caminho do jar para um **caminho absoluto**, antes do
`cd "$TARGET_DIR"` mais abaixo. Isso existe porque encontramos um bug real
durante o desenvolvimento: se `TOOL_JAR` fosse um caminho relativo
(`target/tool.jar`) e o script mudasse de pasta antes de usá-lo, esse
caminho relativo passaria a apontar pra dentro da pasta errada. `dirname`/
`basename` separam "pasta" de "nome do arquivo"; entrar na pasta com `cd` e
pegar `pwd` (que sempre devolve caminho absoluto) resolve a ambiguidade.

```bash
CHANGED_FILES="$(mktemp)"
GRAPH_JSON="$(mktemp)"
trap 'rm -f "$CHANGED_FILES" "$GRAPH_JSON"' EXIT
```
`mktemp` cria um arquivo temporário vazio com nome único (evita colisão se
dois processos rodarem ao mesmo tempo). `trap ... EXIT` registra uma
limpeza: "não importa como este script termine (sucesso, erro, `Ctrl+C`),
rode este comando antes de sair" — garante que não deixamos lixo temporário
espalhado pelo disco.

```bash
git diff --name-only "$BASE_REF" "$HEAD_REF" -- '*.py' > "$CHANGED_FILES"
```
O `git diff` de sempre, mas com um filtro (`-- '*.py'`) — sem isso, um commit
que mexe em `README.md` junto com `calculator.py` traria os dois, e o
extrator perderia tempo processando uma mudança irrelevante (ou, pior,
`Main.java` tentaria tratar `README.md` como um nó, o que é inofensivo mas
desnecessário).

```bash
python "$EXTRACTOR" --repo-root "$TARGET_ABS" --out "$GRAPH_JSON"

SELECTED_TESTS="$(java -jar "$TOOL_JAR" \
  --graph-json "$GRAPH_JSON" \
  --changed-files "$CHANGED_FILES" \
  --format csv)"
```
Aqui a "cola" de verdade acontece: primeiro o extrator Python escreve o
grafo no arquivo temporário `GRAPH_JSON`; depois o jar Java **lê esse mesmo
arquivo** via `--graph-json`. Dois processos completamente diferentes (um
Python, um Java) se comunicando só através de um arquivo — é a essência do
"contrato JSON" que documentamos em `docs/graph-schema.md`. Nenhum dos dois
precisa saber nada sobre a implementação do outro, só sobre o formato do
arquivo.

```bash
TEST_PATHS="$(echo "$SELECTED_TESTS" | tr ',' ' ')"
python -m pytest $TEST_PATHS
```
`tr ',' ' '` troca cada vírgula por um espaço — transforma
`tests/a.py,tests/b.py` em `tests/a.py tests/b.py`. O `$TEST_PATHS` **sem
aspas** aqui é proposital (embora incomum em scripts bem escritos, que
normalmente evitam isso): sem aspas, o Bash faz "word splitting" — quebra a
string nos espaços e passa cada pedaço como um argumento separado pro
pytest, que é exatamente o que queremos (`pytest tests/a.py tests/b.py`,
dois argumentos, não um argumento só com espaço no meio).

### Detecção automática de Maven vs Gradle (só no `select-tests.sh` do Java)

```bash
if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  BUILD_TOOL="gradle"
else
  BUILD_TOOL="maven"
fi
```

O `AstIndexer` não se importa com o build tool — ele só lê `.java` de pastas.
Mas o comando final que roda os testes selecionados é diferente em cada um:
Maven aceita uma lista separada por vírgula (`-Dtest=Foo,Bar`); Gradle exige
uma flag `--tests` repetida por classe. Este trecho decide qual sintaxe
gerar, checando qual arquivo de build existe na pasta do projeto alvo
(depois do `cd "$TARGET_DIR"` — importante rodar a checagem só depois de já
estar dentro da pasta certa).

```bash
GRADLE_ARGS=()
IFS=',' read -ra TEST_NAMES <<< "$SELECTED_TESTS"
for name in "${TEST_NAMES[@]}"; do
  GRADLE_ARGS+=(--tests "$name")
done
"$GRADLE_CMD" test "${GRADLE_ARGS[@]}"
```

`IFS=',' read -ra TEST_NAMES <<< "$SELECTED_TESTS"` quebra a string CSV
(`Foo,Bar`) num **array** bash (`TEST_NAMES=(Foo Bar)`) — diferente do
`tr`+word-splitting usado pro pytest/Jest, aqui precisamos de um array de
verdade porque cada nome precisa virar **dois** argumentos separados
(`--tests` e o nome), não um só. O loop monta `GRADLE_ARGS` como
`(--tests Foo --tests Bar)`, e `"${GRADLE_ARGS[@]}"` (com aspas e `[@]`)
expande preservando cada elemento como um argumento individual — a forma
correta de repassar um array montado dinamicamente pra outro comando.

---

## `.github/workflows/ci.yml` — rodando isso tudo sozinho

Um arquivo YAML (formato de configuração baseado em indentação, sem chaves
como JSON) que o GitHub lê e transforma em um "robô" que roda seus comandos
automaticamente.

```yaml
on:
  pull_request:
    branches: [main]
```
Isso é o **gatilho**: "só rode este workflow quando alguém abrir (ou
atualizar) um Pull Request contra a branch `main`". Sem um PR, nada
acontece — é por isso que testar isso exige abrir um PR de verdade, não só
dar `git push` numa branch.

```yaml
jobs:
  build-tool:
    ...
  selective-tests-java:
    needs: build-tool
    ...
```
Cada `job` roda numa máquina virtual **isolada e limpa** (o `runs-on:
ubuntu-latest` — literalmente uma VM Linux nova, sem nada instalado além do
sistema operacional base). `needs: build-tool` diz "espere o job
`build-tool` terminar antes de começar este" — sem isso, os jobs rodariam
todos ao mesmo tempo, em paralelo, e `selective-tests-java` tentaria usar um
jar que ainda não existe.

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: tool-jar
    path: target/test-graph-selector-*.jar
```
Como cada job roda numa VM isolada, o jar compilado no `build-tool` **não
existe automaticamente** nas VMs dos outros jobs — cada VM é do zero.
`upload-artifact`/`download-artifact` são o mecanismo do GitHub Actions pra
"passar um arquivo de um job pro outro": um salva num espaço temporário
compartilhado, o outro baixa de lá.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```
`checkout` é o passo que faz o `git clone` do seu repositório dentro da VM
(lembra: isso é sempre necessário, com ou sem esta ferramenta — é o "custo
inevitável" que discutimos). `fetch-depth: 0` pede o **histórico completo**
de commits, não só o mais recente — necessário porque `git diff` contra o
branch base só funciona se esse histórico estiver disponível.

---

## Glossário rápido

| Termo | Definição curta |
|---|---|
| **AST** | Árvore de Sintaxe Abstrata — representação do código como estrutura de dados navegável, não como texto |
| **Symbol Solver / Type Checker** | Componente que resolve "este nome se refere exatamente a qual declaração", usando informação de tipos |
| **Grafo dirigido** | Conjunto de nós e arestas onde a direção da aresta importa (A→B ≠ B→A) |
| **BFS (busca em largura)** | Algoritmo que visita um grafo camada por camada, a partir de um nó inicial |
| **Grafo invertido** | O mesmo grafo, com toda aresta virada ao contrário — usado aqui pra achar "quem depende de X" em vez de "de que X depende" |
| **Fat jar / jar sombreado** | Um `.jar` que empacota o seu código + todas as dependências, pronto pra rodar sozinho |
| **`record` (Java)** | Classe curta, só de dados, com construtor/getters/equals gerados automaticamente |
| **CI (Integração Contínua)** | Prática de rodar automaticamente build/testes a cada mudança de código, via um robô (aqui, GitHub Actions) |
| **Pull Request (PR)** | Pedido formal de "juntar esta branch na principal" — o gatilho que dispara o CI neste projeto |
| **Contrato (de dados)** | Um formato acordado (aqui, o JSON de `docs/graph-schema.md`) que permite dois programas diferentes se comunicarem sem conhecer a implementação um do outro |

---

Ficou alguma parte confusa? Aponte o arquivo e a linha — é mais produtivo
aprofundar num ponto específico do que reler o documento inteiro de novo.
