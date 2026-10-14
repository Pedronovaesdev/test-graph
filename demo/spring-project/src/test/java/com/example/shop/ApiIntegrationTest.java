package com.example.shop;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

// Aplicacao inteira, chamada pela URL: nenhuma classe do app e citada aqui.
// Sem a regra always_run_markers, este teste nunca seria selecionado.
@SpringBootTest
@AutoConfigureMockMvc
class ApiIntegrationTest {
    @Autowired
    MockMvc mvc;

    @Test
    void totalThroughTheWholeStack() throws Exception {
        mvc.perform(get("/cart/total").param("sku", "abc").param("quantity", "2"))
                .andExpect(content().string("600"));
    }
}
