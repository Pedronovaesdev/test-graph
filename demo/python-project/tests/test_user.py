from app.services.admin import Admin
from app.services.user import User


def test_greeting():
    assert User("Ana", "ana@example.com").greeting() == "Hello, Ana!"


def test_admin_greeting():
    assert Admin("Bia", "bia@example.com").greeting() == "[admin] Hello, Bia!"
