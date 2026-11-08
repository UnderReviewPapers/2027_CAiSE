import getpass
import os
import logging

import pandas as pd
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from framework.core.agent_metric import AgentMetrics
from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step
from framework.utils.parsers import extract_json
from framework.utils.utils import remap_ids_by_title, drop_and_count_duplicates_by_title

load_dotenv()
logger = logging.getLogger(__name__)


@register_step("candidate_selection.llm")
class LLMGenerator(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-20b", n_candidates: int = 20):
        self.context = context
        self.model = model
        self.n_candidates = n_candidates
        self.metrics = AgentMetrics()
        self.max_retry = 5

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[LLMGenerator] model: {self.model}")
        self.df = self.context.get("hetrec_df")

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0,
            max_tokens=15000,
        )

    def run(self, data, state: State, user_model: UserModel):
        self.metrics.reset()
        prompt = self.generate_prompt(user_model, state)

        parse_response = []
        n = 0
        while len(parse_response) == 0 and n < self.max_retry:
            parse_response = self._invoke_llm(prompt)
            if parse_response is None:
                parse_response = []
                logger.error(f"No JSON found (in llm_generator) {n}/{self.max_retry}")
            n += 1

        if len(parse_response) == 0:
            return pd.DataFrame([])

        # LLM has no DB access, add placeholder
        for item in parse_response:
            item.setdefault("id", "0")

        candidates = pd.DataFrame(parse_response)
        logger.debug(self.metrics.summary())

        candidates, num_remapped, num_not_matched = remap_ids_by_title(candidates, self.df["movies"])
        candidates, num_duplicates = drop_and_count_duplicates_by_title(candidates)

        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)
            run_log.current_step.set_hallucinated_items(num_remapped, num_not_matched, num_duplicates)

        return candidates

    def _invoke_llm(self, prompt):
        ai_msg = self.llm.invoke(prompt, config={"callbacks": [self.metrics]})
        raw_response = ai_msg.content
        return extract_json(raw_response, caller="llm_generator")

    def generate_prompt(self, user_model: UserModel, state: State) -> list:
        query = state.conversation_history[-1].content
        history = user_model.interaction_history

        formatted_history = ""
        for movie in history:
            formatted_history += (
                f"- date: '{movie['datetime']}', title: '{movie['title']}', "
                f"id: '{movie['movieID']}', rating: '{movie['rating']}'\n"
            )

        return [
            {
                "role": "system",
                "content": f"""You are a movie retrieval system that provides personalized recommendations.
You are provided with the user's interaction history and profile. Your task is to suggest {self.n_candidates} movies that the user is likely to enjoy, based on their history, preferences, and request.
Use your knowledge of movies to provide diverse and relevant recommendations. Do not suggest movies the user has already rated.
Relevance score must be in range [0, 1] where 0 is not relevant and 1 is very relevant for the user.
Do not return duplicate movies (movies with the same title).
Follow this format for your response:
[{{"title": "Movie Title", "score": 0.9}},
{{"title": "Movie Title", "score": 0.8}},
...]
Return only the JSON array without any additional text. Do not add comments, the JSON MUST BE VALID""",
            },
            {
                "role": "user",
                "content": f"User profile and interaction history: {user_model}.\nInteraction history details:\n{formatted_history}\nUser request: '{query}'",
            },
        ]

    def reset(self):
        self.metrics.reset()
