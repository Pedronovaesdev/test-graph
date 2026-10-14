package com.example.shop;

import org.springframework.stereotype.Service;

@Service
public class CartService {
    private final PriceService prices; // conhece so a interface

    public CartService(PriceService prices) {
        this.prices = prices;
    }

    public int total(String sku, int quantity) {
        return prices.priceCents(sku) * quantity;
    }
}
