jest.mock("../src/services/user");

// require() depois do jest.mock: o modulo carregado e a versao automockada.
const { User } = require("../src/services/user");
const { notify } = require("../src/services/notifier");

test("notify uses the user's email (User is automocked)", () => {
  const user = new User("Ana", "ana@example.com");
  expect(jest.isMockFunction(user.greeting)).toBe(true);
  expect(notify({ name: "Bia", email: "bia@example.com" }, "hi")).toBe("[to bia@example.com] hi");
});
