from evaluation.deepeval_metrics import compute_reliability_metrics
from evaluation.deepeval_metrics import compute_engagement_metrics, compute_task_handling_metrics
from evaluation.time_cost_metrics import compute_step_time_metrics, compute_step_token_metrics
import json
from collections import defaultdict
from dotenv import load_dotenv
from pathlib import Path
from rapidfuzz import fuzz, process

load_dotenv()

OUT_DIR = Path(__file__).resolve().parent / "out"


INPUT_FILE_NAME = OUT_DIR / "out_results_Scenario_Movie.json"
OUTPUT_FILE_NAME = OUT_DIR / "computed_results" / f"METRICS_{INPUT_FILE_NAME.name}"

#------------------------------------------------------------------------------------------
#------------------------------------------------------------------------------------------
#------------------------------------------------------------------------------------------

movie_features = None

def main():
    print("Reading: \t", INPUT_FILE_NAME)
    print("Writing: \t", OUTPUT_FILE_NAME)

    with open(INPUT_FILE_NAME, "r", encoding="utf-8") as f:
        data = json.load(f)

    global movie_features
    movie_features = load_movie()

    records = flatten_records(data)

    report = build_report(records)

    # print_report(report)

    with open(OUTPUT_FILE_NAME, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)


#------------------------------------------------------------------------------------------
#------------------------------------------------------------------------------------------
#------------------------------------------------------------------------------------------


def build_report(records):
    report = {}

    report["step_avg_time_seconds"] = compute_step_time_metrics(records)
    report["step_token_costs"] = compute_step_token_metrics(records)

    report["engagement_scores"] = compute_engagement_metrics(records)

    report["task_handling_flexibility"] = compute_task_handling_metrics(records)
    
    report["reliability"] = compute_reliability_metrics(records, get_movie_features)

    report["hallucinations"] = hallucination_logs(records)

    return report

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_results(path):
    """Loads the results JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def flatten_records(data):
    """Flattens the nested results[group][query] structure into a flat
    list of records, each enriched with a unique id.
    """
    records = []
    for group_id, queries in data.get("results", {}).items():
        for query_id, record in queries.items():
            record = dict(record)  # shallow copy
            record["_id"] = f"{group_id}.{query_id}"
            records.append(record)
    return records


def load_movie():
    from pathlib import Path
    import pickle
    BASE_DIR = Path(__file__).resolve().parent

    with open(BASE_DIR / "datasets" / "hetrec_extracted.pkl", "rb") as f:
        dataframes = pickle.load(f)

    movies = dataframes['movies'][['id', 'title', 'year', 'rtAudienceRating', 'rtAllCriticsRating']].copy()
    genres = (
        dataframes['movie_genres']
        .groupby('movieID')['genre']
        .apply(lambda x: ", ".join(sorted(x)))
        .reset_index()
        .rename(columns={'movieID': 'id', 'genre': 'genres'})
    )

    details = movies.merge(genres, on='id', how='left')

    details['_norm_title'] = details['title'].str.lower().str.strip()
    details = details.set_index('id', drop=False)
    
    return details

def _safe(value, default):
    import pandas as pd
    if pd.isna(value) or (isinstance(value, str) and value.strip() == ""):
        return default
    return value

def _format_features(row):
    genres = _safe(row['genres'], "unknown genres")
    year = _safe(row['year'], "unknown year")
    audience = _safe(row['rtAudienceRating'], "N/A")
    critics = _safe(row['rtAllCriticsRating'], "N/A")
    return f"{row['title']} ({year}) - Genres: {genres}, Audience rating: {audience}, Critics rating: {critics}"

def get_movie_features(title, movie_id=None, threshold=85):
    """
    Returns a string with the movie's characteristics (genre, year, rating)
    given a title (possibly inexact / hallucinated). None if no sufficient match is found.
    """

    # 1. exact match on id if available
    if movie_id is not None:
        movie_id = str(movie_id)
        if movie_id in movie_features.index.astype(str).values:
            row = movie_features.loc[movie_features.index.astype(str) == movie_id].iloc[0]
            return _format_features(row)

    # 2. fallback: fuzzy match on the title
    if title is None:
        return None

    query = title.lower().strip()

    # fuzzy match on the normalized title
    match = process.extractOne(
        query,
        movie_features['_norm_title'],
        scorer=fuzz.token_sort_ratio,
        score_cutoff=threshold,
    )

    if match is None:
        return None

    _, score, idx = match
    row = movie_features.loc[idx]
    return _format_features(row)

def hallucination_logs(records):
    print("computing hallucination logs")
    res = []
    for record in records:
        run_log = record.get("run_log")
        if run_log:
            for s in run_log.get("steps"):
                num_remapped = int(s.get("num_remapped") or 0)
                num_not_matched = int(s.get("num_not_matched") or 0)
                num_duplicates = int(s.get("num_duplicates") or 0)

                res.append(
                    {
                        "query_id": record["_id"],
                        "step_name": s["step_name"],
                        "num_remapped": num_remapped,
                        "num_not_matched": num_not_matched,
                        "num_duplicates": num_duplicates,
                    }
                )
    return res
        

if __name__ == "__main__":
    main()