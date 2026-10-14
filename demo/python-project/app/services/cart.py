from dataclasses import dataclass, field

from app.utils.math import add, multiply
from ..utils.money import money  # import relativo


@dataclass
class Item:
    name: str
    price_cents: int
    quantity: int


@dataclass
class Cart:
    items: list[Item] = field(default_factory=list)

    def add_item(self, item: Item) -> None:
        self.items.append(item)

    def total(self) -> int:
        result = 0
        for item in self.items:
            result = add(result, multiply(item.price_cents, item.quantity))
        return result

    def formatted_total(self) -> str:
        return money(self.total())
