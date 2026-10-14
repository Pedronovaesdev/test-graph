package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.shop.model.Item;
import org.junit.jupiter.api.Test;

class CartTest {
    @Test
    void sumsItems() {
        Cart cart = new Cart();
        cart.addItem(new Item("pen", 150, 2));
        cart.addItem(new Item("book", 1000, 1));
        assertEquals(1300, cart.total());
        assertEquals("$13.00", cart.formattedTotal());
    }
}
