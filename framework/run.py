from framework.core.result_saver import ResultSaver
from anthropic.types.beta import user_profile_update_params
import getpass
import os
import sys
import logging
from pathlib import Path

from dotenv import load_dotenv

from framework.config.loader import load_config, load_queries
from framework.builder.builder import build_system
from framework.core.execution_context import ExecutionContext
from framework.load_context import load_execution_context

load_dotenv()

if not os.environ.get("API_KEY"):
    os.environ["API_KEY"] = getpass.getpass("Enter your API key: ")

def setup_logging(debug=False):
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(asctime)s - %(levelname)s: %(message)s"
    )
    out_dir = Path(__file__).resolve().parent / "out"

    error_handler = logging.FileHandler(out_dir / "errors.log")
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s: %(message)s"))
    logging.getLogger().addHandler(error_handler)

    logging.getLogger("httpx").setLevel(logging.ERROR)
    logging.getLogger("langchain").setLevel(logging.ERROR)
    logging.getLogger("langchain_core").setLevel(logging.ERROR)
    logging.getLogger("langchain_openai").setLevel(logging.ERROR)
    logging.getLogger("openai").setLevel(logging.ERROR)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

setup_logging(debug="--debug" in sys.argv)
logger = logging.getLogger(__name__)

results = {}
def main():
    query_path = "queries.json"
    output_filename = f"output_results.json"

    logger.debug("Starting framework system...")
    logger.info(f"Using query file: {query_path}")
    logger.info(f"Using output file: {output_filename}")

    cfg = load_config()
    context = load_execution_context()
    system = build_system(cfg, context)  # registers and instantiates steps + orchestrator
    queries = load_queries(query_path)
    saver = ResultSaver()
    logger.debug("System built successfully. Running system...")
    
    for i, test_case in enumerate(queries, 1):
        logger.info(f"Processing test case: {i}")
        
        # reset components
        system.reset()
        
        for iq, query in enumerate(test_case["queries"], 1):
            logger.info(f"- - - - - - - - \nProcessing query: {query}")

            context = {"query": query, "interaction_history": test_case["history"], "user_id": test_case["user_id"]}
            result, run_log = system.run(context)
            logger.info(f">>> Query result for {i}-{iq}-{query}: \n\n>>> {result['response'][:200]}")
            logger.debug(f"Run log: {run_log.to_dict()}")
            saver.save_result(
                test_id=i,
                query_id=iq,
                query=query,
                interaction_history=test_case["history"],
                intent_type=test_case["type"],
                result={
                    "response": result["response"],
                    "recommended_items": extract_recommended_titles(system, result["recommended_items"])
                },
                run_log=run_log.to_dict()
            )
            saver.save_full_log_data(run_log.full_data_log_to_dict())

    extra = {
        "query_path": query_path,
        "queries": queries
    }
    saver.save_to_json(cfg, output_filename, extra)


def extract_recommended_titles(system, recommended_items):
    # [{'id': 296, 'score': 0.8732635027931508}, ...]
    movies = system.context._resources["hetrec_df"]["movies"]

    for item in recommended_items:
        movie_id = int(item["id"])
        match = movies.loc[movies["id"] == movie_id, "title"]
        if not match.empty:
            item["title"] = match.values[0]
        else:
            item["title"] = "Unknown title"

    return recommended_items

    
    

if __name__ == "__main__":
    main()