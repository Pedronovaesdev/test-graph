import { User } from "./user";

export function notify(user: User, message: string): string {
  return `[to ${user.email}] ${message}`;
}
