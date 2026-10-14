from .user import User


class Admin(User):
    """Heranca: Admin depende de User."""

    def greeting(self) -> str:
        return "[admin] " + super().greeting()
