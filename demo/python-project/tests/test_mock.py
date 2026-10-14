from unittest import mock

from app.services import notifier


def test_notify_with_patched_user():
    # O alvo do patch e uma string: invisivel para o AST.
    with mock.patch("app.services.user.User.greeting", return_value="patched"):
        from app.services.user import User

        assert User("x", "x@example.com").greeting() == "patched"
    assert notifier.notify(User("Caio", "caio@example.com"), "hi") == "[to caio@example.com] hi"
