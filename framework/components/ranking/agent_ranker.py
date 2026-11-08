from framework.utils.utils import drop_and_count_duplicates_by_title
from framework.utils.utils import remap_ids_by_title
import getpass
from framework.core.agent_metric import AgentMetrics
from framework.utils.parsers import extract_json
import os
import json
import pandas as pd
from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langchain_core.tools import tool
import duckdb
import logging

from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

logger = logging.getLogger(__name__)


@register_step("ranking.agent")
class AgentRanker(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-120b", top_k: int = 10):
        self.context = context
        self.model = model
        self.top_k = top_k
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[AgentRanker] model: {self.model}")
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
            logger.error("AgentRanker: data is empty")
            return pd.DataFrame([])
        candidates = data.copy()
        candidates["id"] = candidates["id"].astype(str)

        prompt = self._build_prompt(candidates, user_model, state)
        ai_msg = self.agent.invoke({"messages": prompt}, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg["messages"][-1].content

        ranked = extract_json(raw_response, caller="agent_ranker")
        ranked_df = pd.DataFrame(ranked)  # [{"id": ..., "rank": ..., "reason": ...}]
        ranked_df["id"] = ranked_df["id"].astype(str)
        ranked_df["rank"] = pd.to_numeric(ranked_df["rank"], errors="coerce")
        ranked_df = ranked_df.rename(columns={"reason": "reason_ranker"})

        # Rename any 'reason' column coming from the scorer to avoid pandas _x/_y suffixing
        candidates = candidates.rename(columns={"reason": "reason_scorer"})

        candidates, num_remapped, num_not_matched = remap_ids_by_title(candidates, self.df["movies"])
        candidates, num_duplicates = drop_and_count_duplicates_by_title(candidates)

        result = (
            candidates
            .merge(ranked_df[["id", "rank", "reason_ranker"]], on="id", how="inner")
            .sort_values("rank")
            .head(self.top_k)
            .reset_index(drop=True)
        )

        # Attach metrics snapshot to the current pipeline step record.
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

        candidate_list = candidates[["id", "title", "score"]].to_dict(orient="records")
        formatted_candidates = json.dumps(candidate_list, indent=2)
        query = state.conversation_history[-1].content

        return [
            {"role": "system",
            "content": f"""You are a movie ranking system. Given a user's profile and a list of scored candidate movies, your task is to re-rank them by predicted relevance for this specific user.

                            You can query the movies table to enrich candidates with metadata (genres, etc.) before ranking.

                            Table: movies
                            Schema:
                            {self.schema}

                            Rules:
                            - Use the pre-computed score as a signal, but reason beyond it using the user's taste patterns and the user request nuances.
                            - Consider genre affinity, preferences, rating patterns (does the user prefer critically acclaimed vs popular films?), and recency of interactions.
                            - Assign rank 1 to the most relevant movie.
                            - Return exactly {self.top_k} movies.

                            Respond ONLY with a JSON array in this format:
                            [
                            {{"id": "MovieID", "rank": 1, "reason": "one sentence explaining placement"}},
                            ...
                            ]
                            No additional text."""},
            {"role": "user",
            "content": f"""User interaction history:
                            {formatted_history}

                            User profile: {user_model}

                            Scored candidates:
                            {formatted_candidates}

                            User request: '{query}'

                            Query the database for metadata, then produce the final ranking."""}
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