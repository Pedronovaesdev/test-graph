import { add, User } from "../src";

test("barrel re-exports math and user", () => {
  expect(add(1, 1)).toBe(2);
  expect(new User("Caio", "caio@example.com").name).toBe("Caio");
});
