export class User {
  constructor(
    public readonly name: string,
    public readonly email: string,
  ) {}

  greeting(): string {
    return `Hello, ${this.name}!`;
  }
}
