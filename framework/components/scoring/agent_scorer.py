from framework.utils.utils import drop_and_count_duplicates_by_title
import getpass
from framework.core.agent_metric import AgentMetrics
from framework.utils.parsers import extract_json
from framework.utils.utils import remap_ids_by_title
import os
import duckdb
import pandas as pd
import json
from rapidfuzz import process as fuzz_process, fuzz
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain.agents import create_agent

from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step
import logging

logger = logging.getLogger(__name__)


@register_step("scoring.agent")
class AgentScorer(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-120b"):
        self.context = context
        self.model = model
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[AgentScorer] model: {self.model}")
        self.df = self.context.get("hetrec_df")
        self.df["movies"], _ = drop_and_count_duplicates_by_title(self.df["movies"])

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
            temperature=0.0,
        )
        self.agent = create_agent(self.llm, [query_movies_table])

    def run(self, data: pd.DataFrame, state: State, user_model: UserModel) -> pd.DataFrame:
        self.metrics.reset()
        if len(data) == 0:
            logger.error("AgentScorer: data is empty")
            return pd.DataFrame([])

        candidates = data
        if "title" not in candidates.columns:
            movies_titles = self.df["movies"][["id", "title"]].copy()
            movies_titles["id"] = movies_titles["id"].astype(str)
            candidates = candidates.copy()
            candidates["id"] = candidates["id"].astype(str)
            candidates = candidates.merge(movies_titles, left_on="id", right_on="id", how="left")

        prompt = self._build_prompt(candidates, user_model, state)

        ai_msg = self.agent.invoke({"messages": prompt}, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg["messages"][-1].content

        scores = extract_json(raw_response, caller="agent_scorer")
        scores_df = pd.DataFrame(scores)
        scores_df["id"] = scores_df["id"].astype(str)

        candidates = candidates.copy()
        candidates["id"] = candidates["id"].astype(str)

        candidates = candidates.drop(columns=["score"], errors="ignore")
        candidates, num_remapped, num_not_matched = remap_ids_by_title(candidates, self.df["movies"])
        candidates, num_duplicates = drop_and_count_duplicates_by_title(candidates)

        result = candidates.merge(
            scores_df[["id", "score", "reason"]],
            on="id",
            how="left"
        )
        result["score"] = pd.to_numeric(result["score"], errors="coerce").fillna(0.0)

        # Attach metrics snapshot to the current pipeline step record.
        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)
            run_log.current_step.set_hallucinated_items(num_remapped, num_not_matched, num_duplicates)

        with open("scores_agent.json", "a") as f:
            json.dump(result.to_dict("records"), f, indent=4)

        return result

    def _build_prompt(self, candidates: pd.DataFrame, user_model: UserModel, state) -> list:
        formatted_history = ""
        for movie in user_model.interaction_history:
            formatted_history += (
                f"- date: '{movie['datetime']}', title: '{movie['title']}', "
                f"id: '{movie['movieID']}', rating: '{movie['rating']}'\n"
            )

        candidate_cols = ["id", "title"] + [col for col in ["score"] if col in candidates.columns]
        candidate_list = candidates[candidate_cols].to_dict(orient="records")
        formatted_candidates = json.dumps(candidate_list, indent=2)

        return [
            {"role": "system",
            "content": f"""You are a movie scoring system. Given a user profile, a list of candidate movies and the user query, 
                            your task is to assign a relevance score (0.0 to 1.0) to each candidate based on how likely the user is to enjoy it.

                            You can query the movies table to retrieve additional metadata (genres, ratings, etc.) for any candidate before scoring.

                            Table: movies
                            Schema:
                            {self.schema}

                            Respond ONLY with a JSON array in this format:
                            [
                            {{"id": "MovieID", "score": 0.87, "reason": "one sentence explaining why"}},
                            ...
                            ]
                            One entry per candidate. No additional text. Each movie must have its correct score and reason."""},
            {"role": "user", "content": f"""User interaction history:
                            {formatted_history}

                            User query: {state.conversation_history[-1].content}

                            User profile: {user_model}

                            Candidates to score:
                            {formatted_candidates}

                            Query the database to enrich the candidates with metadata, then assign a score to each.
                            Do not add new movies to the list. Do not return duplicate movies (movies with the same title)."""
            }
        ]


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