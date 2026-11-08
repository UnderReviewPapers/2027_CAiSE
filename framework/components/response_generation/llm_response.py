import getpass
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

load_dotenv()
logger = logging.getLogger(__name__)


@register_step("response_generation.llm")
class LLMOutputGenerator(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-20b"):
        self.context = context
        self.model = model
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[LLMOutputGenerator] model: {self.model}")
        self.df = self.context.get("hetrec_df")
        self.movie_details = self._precompute()

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0.7,
        )

    def _precompute(self):
        movies = self.df["movies"][
            ["id", "title", "year", "imdbID", "rtAudienceRating", "rtAllCriticsRating"]
        ].copy()

        genres = (
            self.df["movie_genres"]
            .groupby("movieID")["genre"]
            .apply(lambda x: ", ".join(sorted(x)))
            .reset_index()
            .rename(columns={"movieID": "id", "genre": "genres"})
        )

        directors = (
            self.df["movie_directors"]
            .groupby("movieID")["directorName"]
            .apply(lambda x: ", ".join(x))
            .reset_index()
            .rename(columns={"movieID": "id", "directorName": "directors"})
        )

        details = movies.merge(genres, on="id", how="left")
        details = details.merge(directors, on="id", how="left")
        return details.set_index("id")

    def run(self, data, state: State, user_model: UserModel):
        self.metrics.reset()
        intent = state.current_intent

        if intent == "recommend":
            result = self._run_recommend(data, user_model)
        else:
            query = data.get("query", "") if isinstance(data, dict) else ""
            result = self._run_query(query, intent)

        self._attach_metrics()
        return result

    def _run_recommend(self, data, user_model: UserModel):
        if not isinstance(data, pd.DataFrame) or data.empty:
            movie_list = ""
        else:
            movie_list = self._build_movie_list(data)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a friendly movie recommender assistant. "
                    "You are given a ranked list of movies that match the user's preferences. "
                    "Your task is to present these recommendations in a natural, engaging, and conversational way. "
                    "Include the title, year, genres, director, ratings, and IMDb link for each movie. "
                    "Do not invent or add movies beyond those provided."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User profile: {user_model}\n\n"
                    f"Here are the top recommendations to present:\n{movie_list}"
                ),
            },
        ]

        response = self.llm.invoke(messages, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())

        recommended_items = data.to_dict(orient="records") if isinstance(data, pd.DataFrame) else []
        return {"response": response.content, "recommended_items": recommended_items}

    def _run_query(self, query: str, intent: str):
        intent_hint = {
            "ask_info": "The user is asking for factual information about movies. Answer based on your knowledge.",
            "fallback": "The user's intent is unclear or off-topic. Be helpful, do not suggest movies, and invite the user to ask for something else.",
        }.get(intent, "Respond helpfully to the user.")

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a response generator module of a movie recommender system. {intent_hint}\n"
                    "Reply in natural language, concisely and helpfully."
                ),
            },
            {
                "role": "user",
                "content": query,
            },
        ]

        response = self.llm.invoke(messages, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        return {"response": response.content, "recommended_items": []}

    def _build_movie_list(self, data: pd.DataFrame) -> str:
        lines = []
        for i, (_, row) in enumerate(data.iterrows(), start=1):
            movie_id = int(row["id"])
            details = self.movie_details.loc[movie_id].to_dict() if movie_id in self.movie_details.index else {}
            merged = {**details, **row.to_dict()}

            imdb_url = f"https://www.imdb.com/title/tt{str(merged.get('imdbID', '')).zfill(7)}/"
            audience = _safe_float(merged.get("rtAudienceRating"), "{:.1f}/5")
            critics = _safe_float(merged.get("rtAllCriticsRating"), "{:.1f}/10")

            lines.append(
                f"{i}. {merged.get('title', 'Unknown')} ({merged.get('year', '?')})"
                f" | Genres: {merged.get('genres', 'N/A')}"
                f" | Director: {merged.get('directors', 'N/A')}"
                f" | Audience: {audience} | Critics: {critics}"
                f" | IMDb: {imdb_url}"
            )
        return "\n".join(lines)

    def _attach_metrics(self):
        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)

    def reset(self):
        self.metrics.reset()


def _safe_float(value, fmt, default="N/A"):
    if pd.isna(value):
        return default
    try:
        return fmt.format(float(value))
    except (ValueError, TypeError):
        return default
