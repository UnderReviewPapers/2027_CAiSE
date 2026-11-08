from framework.core.agent_metric import AgentMetrics
from framework.utils.parsers import extract_json_dict
import getpass
import os
import duckdb
from langchain_openai import ChatOpenAI
import pandas as pd
from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step
from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain.agents import create_agent
import json
import logging

load_dotenv()
logger = logging.getLogger(__name__)

@register_step("input_processing.agent")
class AgentParser(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-120b"):
        self.context = context
        self.model = model
        self.metrics = AgentMetrics()

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[AgentParser] model: {self.model}")
        self.df = self.context.get("hetrec_df")
        duckdb.register("movies", self.df["movies"])
        schema_df = duckdb.sql("""DESCRIBE movies""").df()
        _schema = "\n".join(
            f"- {row.column_name}: {row.column_type}"
            for _, row in schema_df.iterrows()
        )
        self.schema = _schema

        self.llm = ChatOpenAI(
            model=self.model,
            base_url=os.environ.get("BASE_URL"),
            api_key=os.environ.get("API_KEY"),
            temperature=0,
        )
        self.agent = create_agent(self.llm, [query_movies_table])

    def run(self, data, state: State, user_model: UserModel):
        self.metrics.reset()
        prompt = self.generate_prompt(data["query"], user_model)
        ai_msg = self.agent.invoke({"messages": prompt}, config={"callbacks": [self.metrics]})
        logger.debug(self.metrics.summary())
        raw_response = ai_msg["messages"][-1].content

        parse_response = extract_json_dict(raw_response, caller="agent_parser")

        intent = parse_response.get("intent", "fallback") 
        genres = parse_response.get("genres", [])
        year_range = parse_response.get("year_range", None)
        min_rating = parse_response.get("min_rating", None)

        user_model.update({"genres": genres, "year_range": year_range, "min_rating": min_rating})

        # Attach metrics snapshot to the current pipeline step record.
        run_log = self.context.get("run_log")
        if run_log.current_step is not None:
            run_log.current_step.set_agent_metrics(self.metrics)

        return intent

    def generate_prompt(self, query, user_model: UserModel) -> list:
        """Generate prompt for a test case."""

        return [
            {"role": "system", 
            "content": f"""You are the input parser for a movie recommender system. You are provided with the history of user interactions and the user profile.
            Your task is to update the user profile based on the information extracted from the request. You can add or remove values to the profile, but not invent keys.
            The history, when present, is provided in the format of a list of interactions, where each interaction includes the movieID, datetime, title, and rating.
            Use this information to generate the user profile. You can use tools and data sources available to you to extract correct information to update the user profile.
            Moreover you have to determine the intent of the user. The intent can be: 
            - "recommend": the user wants a recommendation
            - "ask_info": the user wants information about a movie
            - "fallback": the user wants something else or generic conversation
            Follow this format for your response:
            {{intent: "recommend|ask_info|fallback", "genres": ["genre1", "genre2", ...], "year_range": ["minYear", "maxYear"], "min_rating": "minRating"}}
            Return only the JSON object without any additional text.
            You have access to a tool called query_movies_table.
            Table: movies
            Schema:
            {self.schema}

            Generate SQL queries using only these columns.
            """},
            {
                "role": "user",
                "content": f"""These are user profile and interaction history: {user_model}.
                This is the current query: {query}."""
            }
        ]

    def reset(self):
        self.metrics.reset()

@tool
def query_movies_table(query: str) -> str:
    """
    Executes a SQL query on the movies table and returns the results.
    """
    try:
        result = duckdb.sql(query).df()
        return result.to_json(orient="records")
    except Exception as e:
        return f"Error: {e}"