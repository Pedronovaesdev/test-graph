package com.example.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.shop.model.Item;
import org.junit.jupiter.api.Test;

class CheckoutTest {
    @Test
    void sendsTotalThroughNotifier() {
        Cart cart = new Cart();
        cart.addItem(new Item("pen", 150, 2));
        Checkout checkout = new Checkout(new EmailNotifier());
        assertEquals("[email to ana] total $3.00", checkout.complete(cart, "ana"));
    }
}
