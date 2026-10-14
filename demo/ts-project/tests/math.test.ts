import { add, multiply } from "../src/utils/math";

describe("math", () => {
  it("adds", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("multiplies", () => {
    expect(multiply(4, 5)).toBe(20);
  });
});
