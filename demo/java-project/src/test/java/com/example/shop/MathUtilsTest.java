package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.shop.util.MathUtils;
import org.junit.jupiter.api.Test;

class MathUtilsTest {
    @Test
    void adds() {
        assertEquals(5, MathUtils.add(2, 3));
    }

    @Test
    void multiplies() {
        assertEquals(20, MathUtils.multiply(4, 5));
    }
}
