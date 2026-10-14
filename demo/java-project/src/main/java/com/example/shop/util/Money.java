package com.example.shop.util;

public final class Money {
    private Money() {}

    public static String format(int cents) {
        return String.format("$%d.%02d", cents / 100, cents % 100);
    }
}
