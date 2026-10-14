package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.shop.model.Item;
import org.junit.jupiter.api.Test;

class DiscountCartTest {
    @Test
    void appliesDiscount() {
        DiscountCart cart = new DiscountCart(10);
        cart.addItem(new Item("book", 1000, 1));
        assertEquals(900, cart.total());
    }
}
