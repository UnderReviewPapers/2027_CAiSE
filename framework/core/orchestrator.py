from abc import ABC, abstractmethod

class Orchestrator(ABC):
    @abstractmethod
    def run(self, data, state, user_model):
        pass

    @abstractmethod
    def reset(self):
        pass