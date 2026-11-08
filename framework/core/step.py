from abc import ABC, abstractmethod
from framework.core.state import State
from framework.core.user_model import UserModel

class Step(ABC):

    def __init__(self, context):
        self.context = context

    def setup(self):
        pass
    
    @abstractmethod
    def run(self, data, state: State, user_model: UserModel):
        pass
    
    @abstractmethod
    def reset(self):
        pass