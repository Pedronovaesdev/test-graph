from app import User, add


def test_barrel():
    assert add(1, 1) == 2
    assert User("Davi", "davi@example.com").name == "Davi"
