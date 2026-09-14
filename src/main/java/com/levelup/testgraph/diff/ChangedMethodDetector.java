package com.levelup.testgraph.diff;

import com.github.javaparser.Range;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.levelup.testgraph.index.MethodIdResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Dado um arquivo de diff (saida de 'git diff'), encontra todos os metodos Java
 * que foram alterados. Usa JavaParser para analisar o codigo-fonte e mapear
 * linhas alteradas para metodos.
 */
public final class ChangedMethodDetector {

    // Regex para capturar o hunk de diff, ex.: "@@ -1,3 +1,4 @@"
    private static final Pattern HUNK_PATTERN =
            Pattern.compile(
                    "@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,(\\d+))? @@.*"
            );

    /**
     * Dado um arquivo de diff, retorna o conjunto de metodos Java alterados.
     *
     * @param diffFile arquivo de diff (saida de 'git diff')
     * @return conjunto de metodos alterados, no formato "com.example.MyClass.myMethod()"
     * @throws IOException se nao for possivel ler o arquivo
     */
    public Set<String> detect(Path diffFile, Path projectRoot)
            throws IOException {

        Set<String> changedMethods =
                new LinkedHashSet<>();

        String currentFile = null;

        for (String line : Files.readAllLines(diffFile, StandardCharsets.UTF_8)) {

            // Detecta o inicio de um novo arquivo no diff, ex.: "+++ b/src/main/java/com/example/MyClass.java"
            if (line.startsWith("+++ b/")) {

                String file = line.substring("+++ b/".length());

                if (file.endsWith(".java")) {
                    currentFile = file;
                } else {
                    currentFile = null;
                }
                continue;
            }

            if (currentFile == null) {
                continue;
            }

            Matcher matcher =
                    HUNK_PATTERN.matcher(line);

            if (!matcher.matches()) {
                continue;
            }

            int startLine =
                    Integer.parseInt(
                            matcher.group(1)
                    );

            int lineCount =
                    matcher.group(2) == null
                            ? 1
                            : Integer.parseInt(
                            matcher.group(2)
                    );

            if (lineCount == 0) {
                continue;
            }

            int endLine =
                    startLine + lineCount - 1;

            Path file = projectRoot.resolve(currentFile);

            findMethods(
                    file,
                    startLine,
                    endLine,
                    changedMethods
            );
        }

        System.err.println("Analisando arquivo de diff: " + diffFile.toAbsolutePath());

        return changedMethods;
    }

    /**
     * Dado um arquivo Java e um intervalo de linhas alteradas, encontra todos os
     * metodos que se sobrepoem com esse intervalo e adiciona seus identificadores
     * ao conjunto de metodos alterados.
     *
     * @param file          arquivo Java
     * @param startLine     linha inicial do intervalo alterado (1-based)
     * @param endLine       linha final do intervalo alterado (1-based)
     * @param changedMethods conjunto de metodos alterados (saida)
     */
    private void findMethods(
            Path file,
            int startLine,
            int endLine,
            Set<String> changedMethods
    ) {

        if (!Files.exists(file)) {
            return;
        }

        try {

            CompilationUnit cu =
                    StaticJavaParser.parse(file);

            cu.findAll(
                    ClassOrInterfaceDeclaration.class
            ).forEach(type -> {

                String typeName =
                        type.getFullyQualifiedName()
                                .orElse(null);

                if (typeName == null) {
                    return;
                }

                type.getMethods().forEach(method -> {

                    method.getRange()
                            .ifPresent(range -> {

                                if (overlaps(
                                        range,
                                        startLine,
                                        endLine
                                )) {

                                    String methodId =
                                            MethodIdResolver.resolve(
                                                    typeName,
                                                    method
                                            );

                                    changedMethods.add(
                                            methodId
                                    );
                                }
                            });
                });
            });

        } catch (Exception e) {

            System.err.println(
                    "aviso: nao consegui detectar metodo alterado em "
                            + file
                            + ": "
                            + e.getMessage()
            );
        }
    }

    // Retorna true se o intervalo de linhas do metodo (range) se sobrepoe com o intervalo de linhas alteradas (changedStart, changedEnd)
    private boolean overlaps(
            Range range,
            int changedStart,
            int changedEnd
    ) {

        return range.begin.line <= changedEnd
                && range.end.line >= changedStart;
    }
}