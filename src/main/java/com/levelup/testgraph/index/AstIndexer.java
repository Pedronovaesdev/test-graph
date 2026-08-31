package com.levelup.testgraph.index;

import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import com.github.javaparser.resolution.types.ResolvedReferenceType;
import com.github.javaparser.resolution.types.ResolvedType;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.JavaParserTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;
import com.levelup.testgraph.graph.DependencyGraph;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import java.util.stream.Stream;

/**
 * Varre uma ou mais raizes de codigo-fonte Java e monta o {@link DependencyGraph}:
 * cada classe/interface vira um no; heranca e chamadas de metodo (resolvidas via
 * JavaParser Symbol Solver — nao e so casamento textual, e resolucao semantica de
 * verdade) viram arestas. Metodos anotados com @Test marcam o no como teste.
 *
 * Deterministico, sem IA: mesmo codigo-fonte sempre produz o mesmo grafo.
 */
public final class AstIndexer {

    private static final List<String> TEST_ANNOTATIONS =
            List.of("Test", "ParameterizedTest", "TestFactory", "RepeatedTest");

    public DependencyGraph index(List<Path> sourceRoots) throws IOException {
        CombinedTypeSolver typeSolver = new CombinedTypeSolver(new ReflectionTypeSolver());
        for (Path root : sourceRoots) {
            typeSolver.add(new JavaParserTypeSolver(root));
        }
        JavaSymbolSolver symbolSolver = new JavaSymbolSolver(typeSolver);
        ParserConfiguration config = new ParserConfiguration().setSymbolResolver(symbolSolver);
        StaticJavaParser.setConfiguration(config);

        DependencyGraph graph = new DependencyGraph();
        for (Path root : sourceRoots) {
            if (!Files.isDirectory(root)) {
                continue;
            }
            try (Stream<Path> files = Files.walk(root)) {
                List<Path> javaFiles = files.filter(p -> p.toString().endsWith(".java")).toList();
                for (Path file : javaFiles) {
                    indexFile(file, graph);
                }
            }
        }
        return graph;
    }

    private void indexFile(Path file, DependencyGraph graph) {
        CompilationUnit cu;
        try {
            cu = StaticJavaParser.parse(file);
        } catch (IOException e) {
            System.err.println("aviso: nao consegui ler " + file + ": " + e.getMessage());
            return;
        } catch (Exception e) {
            System.err.println("aviso: nao consegui parsear " + file + ": " + e.getMessage());
            return;
        }

        cu.findAll(ClassOrInterfaceDeclaration.class).forEach(type -> {
            String typeName = type.getFullyQualifiedName().orElse(null);
            if (typeName == null) {
                return;
            }
            graph.addNode(typeName);

            boolean isTest = type.getMethods().stream().anyMatch(this::isTestMethod)
                    || typeName.endsWith("Test") || typeName.endsWith("Tests");
            if (isTest) {
                graph.markAsTest(typeName);
            }

            type.getExtendedTypes().forEach(ext -> resolveSafely(ext::resolve)
                    .ifPresent(resolved -> addTypeEdge(graph, typeName, resolved)));
            type.getImplementedTypes().forEach(impl -> resolveSafely(impl::resolve)
                    .ifPresent(resolved -> addTypeEdge(graph, typeName, resolved)));

            type.findAll(MethodCallExpr.class).forEach(call -> resolveSafely(call::resolve)
                    .ifPresent((ResolvedMethodDeclaration resolved) -> {
                        String callee = resolved.declaringType().getQualifiedName();
                        graph.addEdge(typeName, callee);
                    }));
        });
    }

    private void addTypeEdge(DependencyGraph graph, String from, ResolvedType resolvedType) {
        if (resolvedType instanceof ResolvedReferenceType refType) {
            graph.addEdge(from, refType.getQualifiedName());
        }
    }

    private boolean isTestMethod(MethodDeclaration method) {
        return method.getAnnotations().stream()
                .map(AnnotationExpr::getNameAsString)
                .anyMatch(TEST_ANNOTATIONS::contains);
    }

    /** JavaParser lanca exceptions nao-checadas (UnsolvedSymbolException etc.) sempre
     * que a resolucao semantica esbarra em algo fora do classpath indexado — comum e
     * esperado (ex.: chamada pra uma lib externa). Engolimos e seguimos: uma aresta a
     * menos nao invalida o grafo, so o deixa incompleto naquele ponto. */
    private <T> Optional<T> resolveSafely(Supplier<T> resolver) {
        try {
            return Optional.of(resolver.get());
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}
