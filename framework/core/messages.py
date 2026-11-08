class Message:
    def __init__(self, content: str, role: str):
        self.content = content
        self.role = role

    def __str__(self):
        return f"Message(role={self.role}, content={self.content})"