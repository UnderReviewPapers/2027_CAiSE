from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from dotenv import load_dotenv
import os
import getpass
from deepeval.models import GPTModel
from deepeval.metrics.g_eval.utils import Rubric

load_dotenv()

if not os.environ.get("API_KEY"):
    os.environ["API_KEY"] = getpass.getpass("Enter your OpenAI API key: ")


model = GPTModel(
    model="openai.gpt-oss-120b",
    temperature=0,
    api_key=os.environ["API_KEY"],
    base_url=os.environ["BASE_URL"],
)


# ============================================================================
engagement_metric_01 = GEval(
    name="Engagement",
    evaluation_steps=[
        "Read the response and judge how engaging it is for the reader.",
        "A score close to 0 means the response is dry, monotone, purely "
        "informative, like a factual list or technical note.",
        "A score close to 1 means the response is engaging: lively tone, "
        "varied phrasing, makes the reader want to keep reading or interacting.",
        "Do not judge factual correctness, only the engagement/tone of the writing.",
    ],
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
    model=model
)


engagement_metric_rubric = GEval(
    name="Engagement",
    criteria="Score how engaging the response is for the reader, ignoring factual correctness.",
    rubric=[
        Rubric(score_range=(0, 1), expected_outcome="Dry, monotone, purely informational."),
        Rubric(score_range=(2, 3), expected_outcome="Mildly engaging, some personality but mostly flat."),
        Rubric(score_range=(4, 5), expected_outcome="Lively, varied, makes the reader want to keep reading."),
    ],
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
    model=model
)
# ============================================================================

# engagement_metric = engagement_metric_01
engagement_metric = engagement_metric_rubric

def compute_engagement_metrics(records):
    """
    Computes engagement metrics using GEval.
    """
    print("computing engagement")
    results = []
    for r in records:

        query = r["query"]
        response = r["result"]["response"]

        test_case = LLMTestCase(
            input=query,
            actual_output=response,
        )
        engagement_metric.measure(test_case)
        results.append({
            "id": r.get("_id"),
            "score": round(engagement_metric.score, 3),  # [0, 1]
        })
    avg = sum([r["score"] for r in results]) / len(results)
    return {
        "per_query": results,   
        "avg": avg,   
    }


# ============================================================================
# ============================================================================

task_handling_metric = GEval(
    name="TaskHandlingFlexibility",
    criteria=(
        "Determine whether the system was able to handle the type of task implied "
        "by the user's query. Focus on WHETHER the right kind of output was "
        "attempted, not on its quality. For example: if the query implies a "
        "recommendation request, did the system actually produce recommendations "
        "(as opposed to refusing, deflecting, asking unrelated questions, or "
        "giving a generic/off-topic reply)? If the query asks for information, "
        "did the system attempt to provide that information (as opposed to "
        "ignoring the request)?"
    ),
    rubric=[
        Rubric(score_range=(0, 1), expected_outcome="The system failed to handle the task type: it refused, deflected, ignored the implied request, or produced an output of the wrong kind entirely (e.g. info instead of a recommendation, or vice versa)."),
        Rubric(score_range=(2, 3), expected_outcome="The system partially handled the task type: it attempted the right kind of output but only addressed part of what was implied, or mixed it with unrelated content."),
        Rubric(score_range=(4, 5), expected_outcome="The system fully handled the task type: it produced the kind of output the query implied (recommendation, information, etc.), addressing the whole implied request."),
    ],
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
    model=model
)

def compute_task_handling_metrics(records):
    print("computing task handling")

    results = []
    for r in records:
        query = r["query"]
        response = r["result"]["response"]
        test_case = LLMTestCase(
            input=query,
            actual_output=response,
        )
        task_handling_metric.measure(test_case)
        results.append({
            "id": r.get("_id"),
            "score": round(task_handling_metric.score, 3),
        })
    avg = sum([r["score"] for r in results]) / len(results)
    return {
        "per_query": results,   
        "avg": avg,   
    }


from deepeval.metrics import GEval
from deepeval.metrics.g_eval.utils import Rubric
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

recommendation_reliability_metric = GEval(
    name="RecommendationReliability",
    criteria=(
        "Given the user's profile (their query and, if available, their viewing history "
        "with titles/genres they have rated highly), and the characteristics of the "
        "recommended items (genre, director, year, etc.), judge whether the "
        "recommendations are reasonable and well-targeted for this user: do they fit "
        "the user's expressed preferences and/or the tastes shown in their history? "
        "Rely on the suggested movies and characteristics for the evaluation, not on how it is presented."
    ),
    rubric=[
        Rubric(score_range=(0, 1), expected_outcome="Recommendations are largely inconsistent with the user's profile (wrong genres, unrelated to stated preferences or history) and request."),
        Rubric(score_range=(2, 3), expected_outcome="Recommendations partially fit the user's profile and request; some items are relevant, others are off."),
        Rubric(score_range=(4, 5), expected_outcome="Recommendations are well aligned with the user's profile and request, consistent with their stated preferences and/or history."),
    ],
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT, LLMTestCaseParams.CONTEXT],
    model=model
)

def compute_reliability_metrics(records, get_movie_features):
    print("computing reliability")
    results = []
    for r in records:
        if r.get("intent_type") != "recommend":
            continue

        items = r.get("result", {}).get("recommended_items", [])
        # if not items:
        #     continue

        # User profile: query + optional history
        # TODO history should also retrieve movie_features
        history = r.get("interaction_history") or []
        history_summary_parts = []
        for h in history:
            features = get_movie_features(title=h["title"], movie_id=h["movieID"])
            if features:
                history_summary_parts.append(f"{features} (user rating: {h['rating']})")
            else:
                history_summary_parts.append(f"{h['title']} (user rating: {h['rating']}, no metadata found)")

        history_summary = "; ".join(history_summary_parts) if history_summary_parts else "no prior history available"

        # Characteristics of the recommended items
        item_descriptions = []
        for it in items:
            features = get_movie_features(it["title"])
            if features:
                item_descriptions.append(f"{it['title']}: {features}")
            else:
                item_descriptions.append(f"{it['title']}: (no metadata found, possibly hallucinated)")

        context = [f"User viewing history: {history_summary}"] + item_descriptions
        query = r["query"]
        response = r["result"]["response"]

        test_case = LLMTestCase(
            input=query,
            actual_output=response,
            context=context,
        )
        recommendation_reliability_metric.measure(test_case)

        results.append({
            "query": query,
            "reliability": recommendation_reliability_metric.score,
            "reason": recommendation_reliability_metric.reason,
        })

    return results