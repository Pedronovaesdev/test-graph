package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

// Sobe o contexto, mas cita GreetingService: tem aresta no AST.
@SpringBootTest(classes = {GreetingService.class, Clock.class})
class GreetingServiceTest {
    @Autowired
    GreetingService greetings;

    @Test
    void greets() {
        assertEquals("Hello, Ana (today)", greetings.greet("Ana"));
    }
}
