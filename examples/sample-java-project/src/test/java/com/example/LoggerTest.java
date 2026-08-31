package com.example;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

class LoggerTest {

    @Test
    void logsWithoutThrowing() {
        assertDoesNotThrow(() -> new Logger().log("hello"));
    }
}
