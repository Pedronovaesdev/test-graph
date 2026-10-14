package com.example.shop;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

// Fatia web: so o CartController sobe; o CartService e um mock.
@WebMvcTest(CartController.class)
class CartControllerWebTest {
    @Autowired
    MockMvc mvc;

    @MockitoBean
    CartService cart;

    @Test
    void returnsTotal() throws Exception {
        when(cart.total(anyString(), anyInt())).thenReturn(42);
        mvc.perform(get("/cart/total").param("sku", "x").param("quantity", "1"))
                .andExpect(content().string("42"));
    }
}
