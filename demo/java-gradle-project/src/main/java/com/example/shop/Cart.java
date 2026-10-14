package com.example.shop;

import com.example.shop.model.Item;
import com.example.shop.util.*;

import java.util.ArrayList;
import java.util.List;

public class Cart {
    protected final List<Item> items = new ArrayList<>();

    public void addItem(Item item) {
        items.add(item);
    }

    public int total() {
        int sum = 0;
        for (Item item : items) {
            sum = MathUtils.add(sum, MathUtils.multiply(item.priceCents(), item.quantity()));
        }
        return sum;
    }

    public String formattedTotal() {
        return Money.format(total());
    }
}
