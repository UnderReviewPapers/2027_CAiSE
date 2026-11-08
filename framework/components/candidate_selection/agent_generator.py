from framework.core.agent_metric import AgentMetrics
from framework.utils.parsers import extract_json
from framework.utils.utils import remap_ids_by_title, drop_and_count_duplicates_by_title
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

@register_step("candidate_selection.agent")
class AgentGenerator(Step):

    def __init__(self, context: ExecutionContext, model: str = "openai.gpt-oss-120b", n_candidates: int = 20):
        self.context = context
        self.model = model
        self.n_candidates = n_candidates
        self.metrics = AgentMetrics()
        self.max_retry = 5

    def setup(self):
        if not os.environ.get("API_KEY"):
            os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")

        print(f"[AgentGenerator] model: {self.model}")
        self.df = self.context.get("hetrec_df")
        self.df["movies"], _ = drop_and_count_duplicates_by_title(self.df["movies"])
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
            max_tokens=15000,
            reasoning_effort="low",
        )
        self.agent = create_agent(self.llm, [query_movies_table])

    def run(self, data, state: State, user_model: UserModel):
        self.metrics.reset()
        history = user_model.interaction_history
        prompt = self.generate_prompt(history, user_model, state)
        
        parse_response = []
        n = 0
        max_attempts = self.max_retry
        while len(parse_response) == 0 and n < max_attempts:
            parse_response = self._invoke_llm(prompt)
            if parse_response is None:
                parse_response = []
                logger.error(f"No JSON found (in agent_generator) {n}/{max_attempts}")
            n += 1
        if len(parse_response) == 0:
            return pd.DataFrame([])
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
        ai_msg = self.agent.invoke({
            "messages": prompt
        }, config={"callbacks": [self.metrics]})

        raw_response = ai_msg["messages"][-1].content
        parse_response = extract_json(raw_response, caller="agent_generator")
        return parse_response

    def generate_prompt(self, history: list, user_model: UserModel, state: State) -> list:
        """Generate prompt for a test case."""

        query = state.conversation_history[-1].content
        formatted_history = ""
        for movie in history:
            formatted_history += (
                f"- data: '{movie['datetime']}', title: '{movie['title']}', id: '{movie['movieID']}', rating: '{movie['rating']}'\n"
            )

        return [
            {"role": "system", 
            "content": f"""You are a movie retriever system that provides personalized recommendations. You are provided with the history of user interactions, the user profile and the user request.
            Your task is to provide {self.n_candidates} movies the user will interact with based on their history and user profile. You should query for more movies and then select the {self.n_candidates} most suitable for the user. Do not return duplicate movies (movies with the same title).
            Do not rely only on rating attributes, use all the information you have.
            The history is provided in the format of a list of interactions, where each interaction includes the movieID, datetime, title, and rating.
            Use this information to make your predictions. You must use tools and data sources available to you.
            Relevance score must be in range [0, 1] where 0 is not relevant and 1 is very relevant for the user.
            Do not stop until you have a list of movies to recommend. Do not return movies that are not relevant for the user.
            You can perform many queries using the available tool. Don't write generic queries, but very specific to exploit the user information you have and can infer from user profile and interaction history and user request.
            Follow this format for your response:
            [{{"title": "Movie Title", "id": "MovieID", "score": "Relevance Score"}},
            {{"title": "Movie Title", "id": "MovieID", "score": "Relevance Score"}},
            {{"title": "Movie Title", "id": "MovieID", "score": "Relevance Score"}},
            {{"title": "Movie Title", "id": "MovieID", "score": "Relevance Score"}},
            {{"title": "Movie Title", "id": "MovieID", "score": "Relevance Score"}},
            ...]
            Return only the JSON array without any additional text.
            You have access to a tool called query_movies_table.
            Do not invent movies nor id.
            Do not response with duplicate movies (movies with the same title).
            Table: movies
            Schema:
            {self.schema}

            Generate SQL queries using only these columns.
            """},
            {
                "role": "user",
                "content": f"These are user profile and interaction history: {user_model}. This is the user request: '{query}'",
            }
        ]
    
    def reset(self):
        self.metrics.reset()

@tool
def query_movies_table(query: str) -> str:
    """
    Executes a SQL query on the movies table and returns the results.
    """
    logger.debug(f"[AgentGenerator] SQL query: {query}")
    try:
        result = duckdb.sql(query).df()
        logger.debug(f"[AgentGenerator] Query result ({len(result)} rows): {result.head(3).to_dict()}")
        return result.to_json(orient="records")
    except Exception as e:
        return f"Error: {e}"