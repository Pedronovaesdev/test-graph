import { User } from "../src/services/user";

test("user greeting", () => {
  expect(new User("Ana", "ana@example.com").greeting()).toBe("Hello, Ana!");
});
