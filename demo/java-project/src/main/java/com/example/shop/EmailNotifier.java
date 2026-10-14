package com.example.shop;

public class EmailNotifier implements Notifier {
    @Override
    public String send(String to, String message) {
        return "[email to " + to + "] " + message;
    }
}
