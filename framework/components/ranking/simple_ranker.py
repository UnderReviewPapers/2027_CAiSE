from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

@register_step("ranking.traditional")
class SortRanker(Step):

    def __init__(self, context: ExecutionContext, top_k=10):
        self.context = context
        self.top_k = top_k

    def run(self, data, state: State, user_model: UserModel):
        scored_candidates = data
        return (
            scored_candidates
            .sort_values('score', ascending=False)
            .head(self.top_k)
            .reset_index(drop=True)
        )
    
    def reset(self):
        pass