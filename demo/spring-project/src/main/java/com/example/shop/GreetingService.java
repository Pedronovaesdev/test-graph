package com.example.shop;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class GreetingService {
    @Autowired // injecao por campo
    private Clock clock;

    public String greet(String name) {
        return "Hello, " + name + " (" + clock.today() + ")";
    }
}
