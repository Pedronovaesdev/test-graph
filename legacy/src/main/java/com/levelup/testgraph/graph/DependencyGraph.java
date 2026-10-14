package com.levelup.testgraph.graph;

import org.jgrapht.Graph;
import org.jgrapht.graph.DefaultEdge;
import org.jgrapht.graph.EdgeReversedGraph;
import org.jgrapht.graph.SimpleDirectedGraph;
import org.jgrapht.traverse.BreadthFirstIterator;

import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Grafo dirigido "quem depende de quem": uma aresta A -> B significa "A chama ou
 * estende B". Um subconjunto dos nos e marcado como teste (JUnit).
 */
public final class DependencyGraph {

    private final Graph<String, DefaultEdge> graph = new SimpleDirectedGraph<>(DefaultEdge.class);
    private final Set<String> testNodes = new HashSet<>();

    public void addNode(String node) {
        graph.addVertex(node);
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

    public void markAsTest(String node) {
        graph.addVertex(node);
        testNodes.add(node);
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

    public int edgeCount() {
        return graph.edgeSet().size();
    }
}
