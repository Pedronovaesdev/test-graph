package com.example.shop;

// Mesmo pacote de Cart: nenhum import. Heranca: DiscountCart extends Cart.
public class DiscountCart extends Cart {
    private final int percent;

    public DiscountCart(int percent) {
        this.percent = percent;
    }

    @Override
    public int total() {
        return super.total() * (100 - percent) / 100;
    }
}
