package com.example.shop;

import org.springframework.stereotype.Service;

// Implementacao injetada pelo Spring onde se pede PriceService.
@Service
public class DefaultPriceService implements PriceService {
    @Override
    public int priceCents(String sku) {
        return sku.length() * 100;
    }
}
