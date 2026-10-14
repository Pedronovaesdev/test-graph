import { money } from "@/utils/money";

test("money formats cents through the @/ alias", () => {
  expect(money(1234)).toBe("$12.34");
});
