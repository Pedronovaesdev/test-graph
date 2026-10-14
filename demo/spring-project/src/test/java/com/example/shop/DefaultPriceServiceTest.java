package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class DefaultPriceServiceTest {
    @Test
    void pricesBySkuLength() {
        assertEquals(300, new DefaultPriceService().priceCents("abc"));
    }
}
