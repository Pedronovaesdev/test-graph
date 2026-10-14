from .user import User


def notify(user: User, message: str) -> str:
    return f"[to {user.email}] {message}"
