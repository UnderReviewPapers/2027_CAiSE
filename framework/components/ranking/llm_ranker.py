import getpass
import json
import logging
import os

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
from framework.utils.utils import drop_and_count_duplicates_by_title, fuzzy_normalize_titles, remap_ids_by_title

load_dotenv()
logger = logging.getLogger(__name__)


@register_step("ranking.llm")
class LLMRanker(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-20b", top_k: int = 10):
        self.context = context
        self.model = model
        self.top_k = top_k
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[LLMRanker] model: {self.model}")
        self.df = self.context.get("hetrec_df")

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0.0,
        )

    def run(self, data: pd.DataFrame, state: State, user_model: UserModel) -> pd.DataFrame:
        self.metrics.reset()

        if len(data) == 0:
            logger.error("LLMRanker: data is empty")
            return pd.DataFrame([])

        candidates = data.copy()
        candidates["id"] = candidates["id"].astype(str)

        prompt = self._build_prompt(candidates, user_model, state)
        ai_msg = self.llm.invoke(prompt, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg.content

        ranked = extract_json(raw_response, caller="llm_ranker")
        if not ranked:
            logger.error("LLMRanker: empty response, falling back to score-based sort")
            return (
                candidates.sort_values("score", ascending=False)
                .head(self.top_k)
                .reset_index(drop=True)
            )

        ranked_df = pd.DataFrame(ranked)
        ranked_df["title"] = ranked_df["title"].astype(str)
        ranked_df["rank"] = pd.to_numeric(ranked_df["rank"], errors="coerce")
        ranked_df = ranked_df.rename(columns={"reason": "reason_ranker"})

        candidates = candidates.rename(columns={"reason": "reason_scorer"})
        candidates, num_remapped, num_not_matched = remap_ids_by_title(candidates, self.df["movies"])
        candidates, num_duplicates = drop_and_count_duplicates_by_title(candidates)

        ranked_df = fuzzy_normalize_titles(ranked_df, candidates["title"].tolist())
        ranked_df = ranked_df.drop_duplicates(subset=["title"])

        result = (
            candidates
            .merge(ranked_df[["title", "rank", "reason_ranker"]], on="title", how="inner")
            .sort_values("rank")
            .head(self.top_k)
            .reset_index(drop=True)
        )

        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)
            run_log.current_step.set_hallucinated_items(num_remapped, num_not_matched, num_duplicates)

        return result

    def _build_prompt(self, candidates: pd.DataFrame, user_model: UserModel, state: State) -> list:
        formatted_history = ""
        for movie in user_model.interaction_history:
            formatted_history += (
                f"- date: '{movie['datetime']}', title: '{movie['title']}', "
                f"id: '{movie['movieID']}', rating: '{movie['rating']}'\n"
            )

        candidate_cols = ["id", "title"] + [
            c for c in ["score", "reason_scorer", "year", "genres"]
            if c in candidates.columns
        ]
        candidate_list = candidates[candidate_cols].to_dict(orient="records")
        formatted_candidates = json.dumps(candidate_list, indent=2, default=str)
        query = state.conversation_history[-1].content

        return [
            {
                "role": "system",
                "content": f"""You are a movie ranking system. Given a user's profile and a list of scored candidate movies, re-rank them by predicted relevance for this specific user.
Rules:
- Use the pre-computed score as a signal, but reason beyond it using the user's taste patterns and the nuances of the user request.
- Consider genre affinity, rating patterns (does the user prefer critically acclaimed vs popular films?), and recency of interactions.
- Assign rank 1 to the most relevant movie.
- Return exactly {self.top_k} movies.
Respond ONLY with a JSON array in this format:
[
  {{"title": "Movie Title", "rank": 1, "reason": "one sentence explaining placement"}},
  ...
]
No additional text.""",
            },
            {
                "role": "user",
                "content": f"""User interaction history:
{formatted_history}

User profile: {user_model}

User request: '{query}'

Scored candidates:
{formatted_candidates}

Produce the final ranking of exactly {self.top_k} movies.""",
            },
        ]

    def reset(self):
        self.metrics.reset()
