from framework.core.execution_context import ExecutionContext


RATING_MAP = {
    "high": 4.0,
    "good": 3.5,
    "low": 3.0
}


import re
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

@register_step("input_processing.rule_based")
class RuleBasedInputParser(Step):

    def __init__(self, context: ExecutionContext):
        self.context = context
        self.genres = None
        
    def setup(self):
        self.df = self.context.get("hetrec_df")

        # expensive preprocessing, done ONCE
        self._precompute()
    
    def _precompute(self):
        self.genres = self.df['movie_genres']['genre'].unique().tolist()
        
    def run(self, request, state: State, user_model: UserModel):

        text = request["query"].lower()
        
        result = {
            "genres": [],
            "year_range": None,
            "min_rating": None,
            "interaction_history": request["interaction_history"],
            "user_id": request["user_id"]
        }

        # genres
        for genre in self.genres:
            if genre.lower() in text:
                result["genres"].append(genre)

        # rating
        for word, val in RATING_MAP.items():
            if word in text:
                result["min_rating"] = val

        # years
        match = re.search(r"year (\d{2,4})", text)
        if match:
            year = int(match.group(1))
            if year < 100:
                year += 1900
            result["year_range"] = (year, year + 10)

        user_model.update(result)

        intent = self._extract_intent(text)

        return intent
    
    def reset(self):
        pass
    
    def _extract_intent(self, query):
        if any(word in query.lower() for word in ["recommend", "suggest"]):
            return "recommend"
        elif any(word in query.lower() for word in ["what", "which", "who"]):
            return "ask_info"
        else:
            return "fallback"


