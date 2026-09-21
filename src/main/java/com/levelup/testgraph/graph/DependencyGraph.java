package com.levelup.testgraph.graph;

import org.jgrapht.Graph;
import org.jgrapht.graph.DefaultEdge;
import org.jgrapht.graph.EdgeReversedGraph;
import org.jgrapht.graph.SimpleDirectedGraph;
import org.jgrapht.traverse.BreadthFirstIterator;

import java.util.*;

/**
 * Grafo dirigido "quem depende de quem": uma aresta A -> B significa "A chama ou
 * estende B". Um subconjunto dos nos e marcado como teste (JUnit).
 */
public final class DependencyGraph {

    private final Graph<String, DefaultEdge> graph = new SimpleDirectedGraph<>(DefaultEdge.class);
    private final Graph<String, DefaultEdge> methodGraph = new SimpleDirectedGraph<>(DefaultEdge.class);
    private final Set<String> testNodes = new HashSet<>();
    private final Set<String> testMethodNodes = new HashSet<>();
    private final Map<String, String> testMethodOwners = new HashMap<>();

    public void addNode(String node) {
        graph.addVertex(node);
    }

    public void addMethodNode(String node) {
        methodGraph.addVertex(node);
    }

    public void addEdge(String from, String to) {
        if (from.equals(to)) {
            return;
        }
        graph.addVertex(from);
        graph.addVertex(to);
        if (!graph.containsEdge(from, to)) {
            graph.addEdge(from, to);
        }
    }

    // Adiciona uma aresta no grafo de métodos, representando uma chamada de método de `from` para `to`.
    public void addMethodEdge(String from, String to) {
        if (from.equals(to)) {
            return;
        }
        methodGraph.addVertex(from);
        methodGraph.addVertex(to);

        if (!methodGraph.containsEdge(from, to)) {
            methodGraph.addEdge(from, to);
        }
    }

    public void markAsTest(String node) {
        graph.addVertex(node);
        testNodes.add(node);
    }

    // Marca um método como teste, associando-o ao seu tipo proprietário (classe).
    public void markMethodAsTest(String method, String owner) {
        methodGraph.addVertex(method);
        testMethodNodes.add(method);
        testMethodOwners.put(method, owner);
    }

    public Set<String> testNodes() {
        return Collections.unmodifiableSet(testNodes);
    }

    public boolean contains(String node) {
        return graph.containsVertex(node);
    }

    /**
     * Todos os nos alcancaveis "de tras pra frente" a partir de {@code start} — ou
     * seja, todo mundo que (transitivamente) depende dele. E essa travessia reversa
     * que responde "quais testes sao afetados se eu mudar esta classe?".
     */
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

    public int nodeCount() {
        return graph.vertexSet().size();
    }

    public int methodNodeCount() {
        return methodGraph.vertexSet().size();
    }

    public int edgeCount() {
        return graph.edgeSet().size();
    }

    public int methodEdgeCount() {
        return methodGraph.edgeSet().size();
    }

    // Retorna true se o método especificado existir no grafo de métodos.
    public boolean containsMethod(String method) { return methodGraph.containsVertex(method); }

    // Retorna true se o método especificado for um método de teste.
    public boolean isTestMethod(String method) { return testMethodNodes.contains(method); }

    // Retorna a classe de teste que contém o método especificado.
    public String testClassOf(String method) { return testMethodOwners.get(method); }

    /**
     * Retorna todos os métodos que (transitivamente) chamam o método especificado, ou seja, todos os "ancestrais" do método no grafo de métodos.
     */
    public Set<String> methodAncestorsOf(String start) {

        if (!methodGraph.containsVertex(start)) {
            return Set.of();
        }

        Graph<String, DefaultEdge> reversed =
                new EdgeReversedGraph<>(methodGraph);

        Set<String> result =
                new LinkedHashSet<>();

        Iterator<String> iterator =
                new BreadthFirstIterator<>(
                        reversed,
                        start
                );

        if (iterator.hasNext()) {
            iterator.next();
        }

        iterator.forEachRemaining(result::add);

        return result;
    }

    /**
     * Imprime o grafo de métodos no console, mostrando cada método e suas chamadas.
     */
    public void printMethodGraph() {
        for (String node: methodGraph.vertexSet()) {
            System.out.println(node);

            for (DefaultEdge edge : methodGraph.outgoingEdgesOf(node)) {
                String destination = methodGraph.getEdgeTarget(edge);
                System.out.println("  -> " + destination);
            }
        }
    }

    /**
     * Retorna o conjunto de métodos de teste que são afetados por uma mudança em um método específico.
     *
     * @param changedMethod o método que foi alterado
     * @return um conjunto de métodos de teste afetados
     */
    public Set<String> affectedTestMethods(String changedMethod) {

        Set<String> tests = new LinkedHashSet<>();

        for (String ancestor : methodAncestorsOf(changedMethod)) {
            if (isTestMethod(ancestor)) {
                tests.add(ancestor);
            }
        }

        return tests;
    }
}
