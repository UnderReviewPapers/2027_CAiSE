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


@register_step("scoring.llm")
class LLMScorer(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-20b"):
        self.context = context
        self.model = model
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[LLMScorer] model: {self.model}")

        self.df = self.context.get("hetrec_df")
        self.df["movies"], _ = drop_and_count_duplicates_by_title(self.df["movies"])

        # Pre-build enriched movie metadata (title, year, genres, ratings)
        movies = self.df["movies"][
            ["id", "title", "year", "rtAudienceRating", "rtAllCriticsRating"]
        ].copy()
        movies["id"] = movies["id"].astype(str)

        genres = (
            self.df["movie_genres"][["movieID", "genre"]]
            .groupby("movieID")["genre"]
            .apply(list)
            .reset_index()
            .rename(columns={"movieID": "id", "genre": "genres"})
        )
        genres["id"] = genres["id"].astype(str)

        self.movie_meta = movies.merge(genres, on="id", how="left")

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0.0,
        )

    def run(self, data: pd.DataFrame, state: State, user_model: UserModel) -> pd.DataFrame:
        self.metrics.reset()

        if len(data) == 0:
            logger.error("LLMScorer: data is empty")
            return pd.DataFrame([])

        candidates = data.copy()
        candidates["id"] = candidates["id"].astype(str)

        # Ensure title column is present
        if "title" not in candidates.columns:
            id_to_title = self.df["movies"][["id", "title"]].copy()
            id_to_title["id"] = id_to_title["id"].astype(str)
            candidates = candidates.merge(id_to_title, on="id", how="left")

        # Enrich candidates with metadata from the DF (no tool needed)
        enriched = candidates.merge(
            self.movie_meta[["id", "year", "genres", "rtAudienceRating", "rtAllCriticsRating"]],
            on="id",
            how="left",
        )

        prompt = self._build_prompt(enriched, user_model, state)
        ai_msg = self.llm.invoke(prompt, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg.content

        scores = extract_json(raw_response, caller="llm_scorer")
        if not scores:
            logger.error("LLMScorer: empty response, returning candidates with score=0")
            candidates["score"] = 0.0
            return candidates

        scores_df = pd.DataFrame(scores)
        scores_df["title"] = scores_df["title"].astype(str)

        candidates = candidates.drop(columns=["score"], errors="ignore")
        candidates, num_remapped, num_not_matched = remap_ids_by_title(candidates, self.df["movies"])
        candidates, num_duplicates = drop_and_count_duplicates_by_title(candidates)

        scores_df = fuzzy_normalize_titles(scores_df, candidates["title"].tolist())
        scores_df = scores_df.drop_duplicates(subset=["title"])

        result = candidates.merge(
            scores_df[["title", "score", "reason"]],
            on="title",
            how="left",
        )
        result["score"] = pd.to_numeric(result["score"], errors="coerce").fillna(0.0)

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
            c for c in ["year", "genres", "rtAudienceRating", "rtAllCriticsRating"]
            if c in candidates.columns
        ]
        candidate_list = candidates[candidate_cols].to_dict(orient="records")
        formatted_candidates = json.dumps(candidate_list, indent=2, default=str)

        return [
            {
                "role": "system",
                "content": """You are a movie scoring system. Given a user profile, their interaction history, and a list of candidate movies with metadata, assign a relevance score (0.0 to 1.0) to each candidate based on how likely the user is to enjoy it.
Use the provided metadata (genres, year, audience rating, critics rating) together with the user's preferences and history to determine each score.
Respond ONLY with a JSON array in this format:
[
  {"title": "Movie Title", "id": "MovieID", "score": 0.87, "reason": "one sentence explaining why"},
  ...
]
One entry per candidate. No additional text. Do not add or remove movies from the list.""",
            },
            {
                "role": "user",
                "content": f"""User interaction history:
{formatted_history}

User query: {state.conversation_history[-1].content}

User profile: {user_model}

Candidates to score:
{formatted_candidates}

Assign a score to each candidate based on the metadata provided and the user's preferences.""",
            },
        ]

    def reset(self):
        self.metrics.reset()
