from abc import ABC, abstractmethod

class InputParser(ABC):
    @abstractmethod
    def parse_input(self, request:str) -> dict:
        pass

class CandidateGenerator(ABC):
    @abstractmethod
    def generate_candidates(self, user_context) -> list:
        pass

class Scorer(ABC):
    @abstractmethod
    def score_candidates(self, user_context, candidates: list) -> list:
        """Return [(item, score)]"""
        pass

class Ranker(ABC):
    @abstractmethod
    def rank(self, scored_items: list) -> list:
        pass

class OutputGenerator(ABC):
    @abstractmethod
    def generate_output(self, ranked_items: list) -> dict:
        pass