import { add, multiply } from "../utils/math";
import { money } from "@/utils/money";

export interface CartItem {
  name: string;
  priceCents: number;
  quantity: number;
}

export class Cart {
  private items: CartItem[] = [];

  addItem(item: CartItem): void {
    this.items.push(item);
  }

  total(): number {
    return this.items.reduce(
      (sum, item) => add(sum, multiply(item.priceCents, item.quantity)),
      0,
    );
  }

  formattedTotal(): string {
    return money(this.total());
  }
}
