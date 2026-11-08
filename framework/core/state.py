from abc import ABC, abstractmethod

class State(ABC):
    @abstractmethod
    def update(self, new_state):
        pass

    @abstractmethod
    def reset(self):
        pass