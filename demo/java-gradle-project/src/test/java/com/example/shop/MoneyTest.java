package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.shop.util.Money;
import org.junit.jupiter.api.Test;

class MoneyTest {
    @Test
    void formatsCents() {
        assertEquals("$12.34", Money.format(1234));
    }
}
