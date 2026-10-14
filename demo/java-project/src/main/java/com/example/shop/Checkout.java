package com.example.shop;

// "Injecao" via construtor: Checkout so conhece a interface Notifier.
public class Checkout {
    private final Notifier notifier;

    public Checkout(Notifier notifier) {
        this.notifier = notifier;
    }

    public String complete(Cart cart, String customer) {
        return notifier.send(customer, "total " + cart.formattedTotal());
    }
}
