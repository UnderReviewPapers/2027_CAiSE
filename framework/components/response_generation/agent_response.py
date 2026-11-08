import getpass
import logging
import os

import duckdb
import pandas as pd
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from framework.core.agent_metric import AgentMetrics
from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

load_dotenv()
logger = logging.getLogger(__name__)


@register_step("response_generation.agent")
class AgentOutputGenerator(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-120b"):
        self.context = context
        self.model = model
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[AgentOutputGenerator] model: {self.model}")
        self.df = self.context.get("hetrec_df")
        self.movie_details = self._precompute()

        duckdb.register("movies", self.df["movies"])
        schema_df = duckdb.sql("DESCRIBE movies").df()
        self.schema = "\n".join(
            f"- {row.column_name}: {row.column_type}"
            for _, row in schema_df.iterrows()
        )

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0.7,
        )

        self.agent = create_agent(self.llm, [query_movies_table])

    def _precompute(self):
        movies = self.df['movies'][['id', 'title', 'year', 'imdbID', 'rtAudienceRating', 'rtAllCriticsRating']].copy()

        genres = (
            self.df['movie_genres']
            .groupby('movieID')['genre']
            .apply(lambda x: ", ".join(sorted(x)))
            .reset_index()
            .rename(columns={'movieID': 'id', 'genre': 'genres'})
        )

        directors = (
            self.df['movie_directors']
            .groupby('movieID')['directorName']
            .apply(lambda x: ", ".join(x))
            .reset_index()
            .rename(columns={'movieID': 'id', 'directorName': 'directors'})
        )

        details = movies.merge(genres, on='id', how='left')
        details = details.merge(directors, on='id', how='left')
        return details.set_index('id')

    def _build_movie_list(self, data: pd.DataFrame) -> str:
        lines = []
        for i, (_, row) in enumerate(data.iterrows(), start=1):
            movie_id = int(row['id'])
            details = self.movie_details.loc[movie_id].to_dict() if movie_id in self.movie_details.index else {}
            merged = {**details, **row.to_dict()}

            imdb_url = f"https://www.imdb.com/title/tt{str(merged.get('imdbID', '')).zfill(7)}/"
            audience = safe_float(merged.get('rtAudienceRating'), "{:.1f}/5")
            critics  = safe_float(merged.get('rtAllCriticsRating'), "{:.1f}/10")

            lines.append(
                f"{i}. {merged.get('title', 'Unknown')} ({merged.get('year', '?')})"
                f" | Genres: {merged.get('genres', 'N/A')}"
                f" | Director: {merged.get('directors', 'N/A')}"
                f" | Audience: {audience} | Critics: {critics}"
                f" | IMDb: {imdb_url}"
            )
        return "\n".join(lines)

    def run(self, data, state: State, user_model: UserModel):
        self.metrics.reset()
        intent = state.current_intent

        if intent == "recommend":
            return self._run_recommend(data, user_model)
        else:
            query = data.get("query", "") if isinstance(data, dict) else ""
            return self._run_query_agent(query, intent)
    # ------------------------------------------------------------------

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
                )
            },
            {
                "role": "user",
                "content": (
                    f"User profile: {user_model}\n\n"
                    f"Here are the top recommendations to present:\n{movie_list}"
                )
            }
        ]

        response = self.llm.invoke(messages, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())

        self._attach_metrics()

        recommended_items = data.to_dict(orient="records") if isinstance(data, pd.DataFrame) else []
        return {"response": response.content, "recommended_items": recommended_items}

    # ------------------------------------------------------------------
    def _run_query_agent(self, query: str, intent: str):
        prompt = self._build_query_prompt(query, intent)
        ai_msg = self.agent.invoke({"messages": prompt}, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg["messages"][-1].content

        self._attach_metrics()
        return {"response": raw_response, "recommended_items": []}

    def _build_query_prompt(self, query: str, intent: str) -> list:
        intent_hint = {
            "ask_info": "The user is asking for factual information about movies.",
            "fallback":  "The user's intent is unclear or off-topic; try to be helpful anyway, but do not suggest movies. You can ask clarifying questions if needed or invite the user to ask for something else.",
        }.get(intent, "Respond helpfully to the user.")

        return [
            {
                "role": "system",
                "content": (
                    f"You are a response generator module of a recommender system. {intent_hint}\n"
                    "You have access to a SQL tool called query_movies_table that queries a 'movies' table.\n"
                    f"Table schema:\n{self.schema}\n\n"
                    "Use the tool when you need data to answer the question accurately. "
                    "Reply in natural language, concisely and helpfully."
                ),
            },
            {
                "role": "user",
                "content": query,
            },
        ]


    def _attach_metrics(self):
        """Attach the current metrics snapshot to the active pipeline step log."""
        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)

    def reset(self):
        self.metrics.reset()

@tool
def query_movies_table(query: str) -> str:
    """Executes a SQL query on the movies table and returns results as JSON."""
    try:
        result = duckdb.sql(query).df()
        return result.to_json(orient="records")
    except Exception as e:
        return f"Error: {e}"

def safe_float(value, fmt, default="N/A"):
    if pd.isna(value):
        return default
    try:
        f = float(value)
    except (ValueError, TypeError):
        return default
    return fmt.format(f)