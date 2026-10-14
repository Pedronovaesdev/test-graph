class User:
    def __init__(self, name: str, email: str) -> None:
        self.name = name
        self.email = email

    def greeting(self) -> str:
        return f"Hello, {self.name}!"
