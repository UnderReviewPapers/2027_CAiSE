from abc import ABC, abstractmethod

class UserModel(ABC):
    @abstractmethod
    def update(self, new_model):
        pass

    @abstractmethod
    def reset(self):
        pass