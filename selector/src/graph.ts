/**
 * Grafo de dependencias e busca nos dois sentidos.
 *
 * O seletor so conhece o formato do `graph.json` (nos + arestas), nao o
 * indexador que o gerou. Convencao de direcao: uma aresta `source -> target`
 * significa "source depende de target" (ex.: `cart.ts --imports--> add()`).
 *
 * - `dependencies(n)`: de quem `n` depende (arestas de saida).
 * - `dependents(n)`: quem depende de `n` (arestas de entrada).
 * - `reverseReach(sementes)`: tudo que depende, direta ou transitivamente,
 *   das sementes. BFS sem limite de profundidade, guardando o pai de cada no
 *   para reconstruir a cadeia completa ate a semente.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./diff";

/**
 * Relacoes seguidas na busca reversa. `contains` (arquivo -> simbolo) e
 * `method` (classe -> metodo) entram porque, no sentido reverso, levam do
 * simbolo afetado para quem o contem: se `Cart.total()` mudou, quem usa
 * `Cart` (ou importa `cart.ts`) tambem pode mudar. O sentido direto delas
 * (arquivo -> todos os simbolos) so e usado para expandir as sementes.
 */
export const DEFAULT_RELATIONS: ReadonlySet<string> = new Set([
  "calls",
  "imports",
  "imports_from",
  "dynamic_import",
  "re_exports",
  "inherits",
  "extends",
  "implements",
  "uses",
  "references",
  "requires",
  "contains",
  "method",
]);

export interface GraphNode {
  id: string;
  label: string;
  sourceFile: string | null;
  sourceLocation: string | null;
}

export interface Edge {
  source: string;
  target: string;
  relation: string;
  location: string | null;
}

/**
 * Como um no foi alcancado na busca. Normalmente `node` depende de `parent`
 * pela aresta `node --relation--> parent`. Com `polymorphic` a aresta e
 * `parent --relation--> node` (ex.: `EmailNotifier --implements--> Notifier`):
 * quem usa a interface pode receber a implementacao alterada em runtime.
 */
export interface Visit {
  node: string;
  parent: string | null;
  relation: string | null;
  location: string | null;
  polymorphic: boolean;
  seedFile: string;
}

/** Uma aresta da cadeia de explicacao, sempre no sentido `dependent -> dependency`. */
export interface Step {
  dependent: string;
  relation: string;
  dependency: string;
  location: string | null;
  polymorphic: boolean;
}

interface RawGraph {
  nodes?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
}

function normPath(p: unknown): string | null {
  if (p === undefined || p === null || p === "") return null;
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function edgeKey(e: Edge, other: string): string {
  return `${other}\0${e.relation}\0${e.location ?? ""}`;
}

export class DependencyGraph {
  readonly nodes = new Map<string, GraphNode>();
  private readonly outEdges = new Map<string, Edge[]>();
  private readonly inEdges = new Map<string, Edge[]>();
  private readonly byFile = new Map<string, string[]>();
  private readonly classOf = new Map<string, string>();

  constructor(rawNodes: Array<Record<string, unknown>>, rawEdges: Array<Record<string, unknown>>, readonly name = "head") {
    for (const raw of rawNodes) {
      const id = String(raw.id);
      const sourceFile = normPath(raw.source_file);
      this.nodes.set(id, {
        id,
        label: raw.label ? String(raw.label) : id,
        sourceFile,
        sourceLocation: raw.source_location ? String(raw.source_location) : null,
      });
      if (sourceFile) push(this.byFile, sourceFile, id);
    }
    const seen = new Set<string>();
    for (const raw of rawEdges) {
      const source = String(raw.source);
      const target = String(raw.target);
      const loc = raw.source_location ? String(raw.source_location) : null;
      const file = normPath(raw.source_file);
      const edge: Edge = {
        source,
        target,
        relation: String(raw.relation),
        location: file && loc ? `${file}:${loc}` : (file ?? loc),
      };
      const key = `${source}\0${target}\0${edge.relation}\0${edge.location ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const endpoint of [source, target]) {
        if (!this.nodes.has(endpoint)) {
          this.nodes.set(endpoint, { id: endpoint, label: endpoint, sourceFile: null, sourceLocation: null });
        }
      }
      push(this.outEdges, source, edge);
      push(this.inEdges, target, edge);
      if (edge.relation === "method" && !this.classOf.has(target)) this.classOf.set(target, source);
    }
    for (const ids of this.byFile.values()) ids.sort(compare);
    // Ordenar as listas de adjacencia torna toda iteracao deterministica.
    for (const list of this.outEdges.values()) list.sort((a, b) => compare(edgeKey(a, a.target), edgeKey(b, b.target)));
    for (const list of this.inEdges.values()) list.sort((a, b) => compare(edgeKey(a, a.source), edgeKey(b, b.source)));
  }

  /**
   * Carrega um `graph.json`. O graphify grava `links` (modo com clusterizacao,
   * formato node-link do networkx) ou `edges` (modo `--no-cluster`).
   */
  static fromJson(file: string, name = "head"): DependencyGraph {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as RawGraph;
    return new DependencyGraph(data.nodes ?? [], data.links ?? data.edges ?? [], name);
  }

  files(): string[] {
    return [...this.byFile.keys()].sort(compare);
  }

  hasFile(file: string): boolean {
    return this.byFile.has(file);
  }

  /** Sementes de um arquivo: o no do arquivo e todo simbolo definido nele. */
  nodesInFile(file: string): string[] {
    return [...(this.byFile.get(file) ?? [])];
  }

  sourceFile(node: string): string | null {
    return this.nodes.get(node)?.sourceFile ?? null;
  }

  /** De quem `node` depende. */
  dependencies(node: string): Edge[] {
    return [...(this.outEdges.get(node) ?? [])];
  }

  /** Quem depende de `node`. */
  dependents(node: string): Edge[] {
    return [...(this.inEdges.get(node) ?? [])];
  }

  /** Resolve id, caminho de arquivo ou label (ex.: `add`, `Cart.total`) para nos. */
  find(query: string): string[] {
    if (this.nodes.has(query)) return [query];
    if (this.byFile.has(query)) {
      const fileNode = this.fileNode(query);
      return fileNode ? [fileNode] : this.nodesInFile(query);
    }
    const wanted = new Set([query, `${query}()`, `.${query}()`]);
    return [...this.nodes.keys()]
      .filter((id) => wanted.has(this.nodes.get(id)!.label) || wanted.has(this.display(id)))
      .sort(compare);
  }

  /** Nome legivel: caminho para nos de arquivo, `Classe.metodo()` para metodos. */
  display(node: string): string {
    const data = this.nodes.get(node);
    if (!data) return node;
    if (data.sourceFile && data.label === path.posix.basename(data.sourceFile)) return data.sourceFile;
    const owner = this.classOf.get(node);
    if (data.label.startsWith(".") && owner) return `${this.nodes.get(owner)!.label}${data.label}`;
    return data.label;
  }

  /**
   * BFS reversa a partir de varias sementes, sem limite de profundidade.
   *
   * `seeds` mapeia no -> arquivo alterado que o tornou semente. Relacoes em
   * `polymorphicRelations` tambem sao seguidas no sentido direto
   * (implementacao afetada -> interface -> quem usa a interface), com dois
   * limites:
   * - so ate supertipos DO PROJETO: `X extends JpaRepository` nao liga X a
   *   todos os outros repositorios, porque o JpaRepository (biblioteca) nao
   *   mudou e ninguem recebe "um X" no lugar dele;
   * - nunca a partir de arquivos de teste (`skipPolymorphicFrom`): um teste
   *   novo herdando de uma base de testes nao afeta os outros testes dela.
   * A ordem de visita depende so da ordenacao dos ids: mesma entrada, mesmas cadeias.
   */
  reverseReach(
    seeds: Map<string, string>,
    relations: ReadonlySet<string> = DEFAULT_RELATIONS,
    polymorphicRelations: ReadonlySet<string> = new Set(),
    skipPolymorphicFrom: (file: string | null) => boolean = () => false,
  ): Map<string, Visit> {
    const visited = new Map<string, Visit>();
    const queue: string[] = [];
    for (const node of [...seeds.keys()].sort(compare)) {
      if (!this.nodes.has(node)) continue;
      visited.set(node, { node, parent: null, relation: null, location: null, polymorphic: false, seedFile: seeds.get(node)! });
      queue.push(node);
    }
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const seedFile = visited.get(current)!.seedFile;
      const candidates: Array<{ node: string; relation: string; location: string | null; polymorphic: boolean }> = [];
      for (const e of this.inEdges.get(current) ?? []) {
        if (relations.has(e.relation)) candidates.push({ node: e.source, relation: e.relation, location: e.location, polymorphic: false });
      }
      if (!skipPolymorphicFrom(this.sourceFile(current))) {
        for (const e of this.outEdges.get(current) ?? []) {
          if (polymorphicRelations.has(e.relation) && this.isProjectNode(e.target)) {
            candidates.push({ node: e.target, relation: e.relation, location: e.location, polymorphic: true });
          }
        }
      }
      candidates.sort(
        (a, b) =>
          compare(a.node, b.node) ||
          Number(a.polymorphic) - Number(b.polymorphic) ||
          compare(a.relation, b.relation) ||
          compare(a.location ?? "", b.location ?? ""),
      );
      for (const c of candidates) {
        if (visited.has(c.node)) continue;
        visited.set(c.node, { node: c.node, parent: current, relation: c.relation, location: c.location, polymorphic: c.polymorphic, seedFile });
        queue.push(c.node);
      }
    }
    return visited;
  }

  /** Cadeia de `node` ate a semente que o alcancou. */
  chain(visited: Map<string, Visit>, node: string): Step[] {
    const steps: Step[] = [];
    let current = visited.get(node)!;
    while (current.parent !== null) {
      steps.push(
        current.polymorphic
          ? { dependent: current.parent, relation: current.relation!, dependency: current.node, location: current.location, polymorphic: true }
          : { dependent: current.node, relation: current.relation!, dependency: current.parent, location: current.location, polymorphic: false },
      );
      current = visited.get(current.parent)!;
    }
    return steps;
  }

  /**
   * Algum no de outro arquivo depende deste arquivo? Conta arestas de entrada
   * (nas relacoes seguidas pela busca) vindas de outro arquivo e, para
   * implementacoes, arestas polimorficas de saida (`X implements Interface`).
   */
  hasDependents(
    file: string,
    relations: ReadonlySet<string> = DEFAULT_RELATIONS,
    polymorphicRelations: ReadonlySet<string> = new Set(),
  ): boolean {
    for (const node of this.byFile.get(file) ?? []) {
      for (const e of this.inEdges.get(node) ?? []) {
        if (relations.has(e.relation) && this.nodes.get(e.source)!.sourceFile !== file) return true;
      }
    }
    return this.supertypeHasConsumers(file, relations, polymorphicRelations);
  }

  /**
   * Uma implementacao (`EmailNotifier implements Notifier`) e usada via DI
   * quando o supertipo tem consumidores reais: alguem que o use, sem contar
   * as outras implementacoes dele. Sobe pela cadeia de supertipos do projeto
   * (`Notifier extends Channel`, usado por `Checkout`). Interface que so as
   * proprias implementacoes conhecem nao conta: a mudanca cai em no-dependents.
   */
  private supertypeHasConsumers(
    file: string,
    relations: ReadonlySet<string>,
    polymorphicRelations: ReadonlySet<string>,
  ): boolean {
    if (polymorphicRelations.size === 0) return false;
    const seen = new Set<string>([file]);
    const queue = [file];
    for (let i = 0; i < queue.length; i++) {
      for (const node of this.byFile.get(queue[i]) ?? []) {
        for (const e of this.outEdges.get(node) ?? []) {
          if (!polymorphicRelations.has(e.relation)) continue;
          const superFile = this.sourceFile(e.target);
          if (superFile === null || seen.has(superFile)) continue;
          seen.add(superFile);
          if (this.hasConsumers(superFile, relations, polymorphicRelations)) return true;
          queue.push(superFile);
        }
      }
    }
    return false;
  }

  /** Algum arquivo usa `superFile` sem ser uma implementacao/subtipo dele. */
  private hasConsumers(superFile: string, relations: ReadonlySet<string>, polymorphicRelations: ReadonlySet<string>): boolean {
    const nodes = this.byFile.get(superFile) ?? [];
    const subtypes = new Set<string>();
    for (const node of nodes) {
      for (const e of this.inEdges.get(node) ?? []) {
        if (polymorphicRelations.has(e.relation)) subtypes.add(this.nodes.get(e.source)!.sourceFile ?? "");
      }
    }
    for (const node of nodes) {
      for (const e of this.inEdges.get(node) ?? []) {
        if (!relations.has(e.relation) || polymorphicRelations.has(e.relation)) continue;
        const from = this.nodes.get(e.source)!.sourceFile;
        if (from !== null && from !== superFile && !subtypes.has(from)) return true;
      }
    }
    return false;
  }

  /** No definido no codigo do projeto (e nao numa biblioteca externa). */
  isProjectNode(node: string): boolean {
    return this.nodes.get(node)?.sourceFile != null;
  }

  /**
   * Primeiro marcador (ex.: `SpringBootTest`) que o arquivo usa, direto ou
   * HERDADO: `class FooTest extends AbstractIntegrationTest` herda o
   * `@SpringBootTest` da base. Sobe pela heranca (`inherits`/`extends`) ate
   * as classes do projeto, transitivamente. Compara com o ultimo trecho do
   * label (`org.springframework...SpringBootTest` -> `SpringBootTest`) e com
   * o fim do id.
   */
  markerUsedBy(file: string, markers: readonly string[]): string | null {
    if (markers.length === 0) return null;
    const wanted = new Map(markers.map((m) => [m.replace(/^@/, "").toLowerCase(), m]));
    const seenFiles = new Set<string>([file]);
    const queue = [file];
    for (let i = 0; i < queue.length; i++) {
      for (const node of this.byFile.get(queue[i]) ?? []) {
        for (const e of this.outEdges.get(node) ?? []) {
          const target = this.nodes.get(e.target)!;
          const last = target.label.replace(/^@/, "").split(".").pop()!.toLowerCase();
          const idLast = target.id.toLowerCase().split("_").pop()!;
          const hit = wanted.get(last) ?? wanted.get(idLast);
          if (hit) return hit;
          if ((e.relation === "inherits" || e.relation === "extends") && target.sourceFile && !seenFiles.has(target.sourceFile)) {
            seenFiles.add(target.sourceFile);
            queue.push(target.sourceFile);
          }
        }
      }
    }
    return null;
  }

  private fileNode(file: string): string | null {
    const base = path.posix.basename(file);
    return this.byFile.get(file)?.find((id) => this.nodes.get(id)!.label === base) ?? null;
  }
}
