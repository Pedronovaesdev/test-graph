# Nao importa Cart: recebe a fixture `cart` do conftest.py.


def test_total(cart):
    assert cart.total() == 1300


def test_formatted_total(cart):
    assert cart.formatted_total() == "$13.00"
