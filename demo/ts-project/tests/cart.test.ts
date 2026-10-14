import { Cart } from "../src/services/cart";

describe("Cart", () => {
  it("sums item totals", () => {
    const cart = new Cart();
    cart.addItem({ name: "pen", priceCents: 150, quantity: 2 });
    cart.addItem({ name: "book", priceCents: 1000, quantity: 1 });
    expect(cart.total()).toBe(1300);
  });

  it("formats the total", () => {
    const cart = new Cart();
    cart.addItem({ name: "pen", priceCents: 150, quantity: 2 });
    expect(cart.formattedTotal()).toBe("$3.00");
  });
});
