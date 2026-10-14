package com.example.shop;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CartController {
    private final CartService cart;

    public CartController(CartService cart) {
        this.cart = cart;
    }

    @GetMapping("/cart/total")
    public int total(@RequestParam String sku, @RequestParam int quantity) {
        return cart.total(sku, quantity);
    }
}
