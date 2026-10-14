import pytest

from app.services.cart import Cart, Item


@pytest.fixture
def cart() -> Cart:
    # Fixture: os testes recebem o Cart por injecao do pytest, sem importa-lo.
    c = Cart()
    c.add_item(Item("pen", 150, 2))
    c.add_item(Item("book", 1000, 1))
    return c
