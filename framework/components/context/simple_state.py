from framework.core.state import State
from framework.registry.registry import register_state

@register_state("state.simple")
class SimpleState(State):
    def __init__(self):
        self.conversation_history = []
        self.current_intent = None


    def update(self, new_message):
        self.conversation_history.append(new_message)

    def set_intent(self, intent):
        self.current_intent = intent

    def reset(self):
        self.conversation_history = []
        self.current_intent = None

    def __str__(self):
        return (
            f"State(\n"
            f"  conversation_history={self.conversation_history},\n"
            f")"
        )