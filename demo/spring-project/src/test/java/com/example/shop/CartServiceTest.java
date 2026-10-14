package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

// Teste unitario: usa uma PriceService falsa, nao a DefaultPriceService.
class CartServiceTest {
    @Test
    void multipliesByQuantity() {
        PriceService fixed = sku -> 250;
        assertEquals(750, new CartService(fixed).total("x", 3));
    }
}
