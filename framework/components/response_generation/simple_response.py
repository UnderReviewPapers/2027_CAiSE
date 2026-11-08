
import re
import random
import pandas as pd

from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

INTRO_TEMPLATES = [
    "Here are some movies you might like:",
    "Based on your preferences, here's what I recommend:",
    "Here's a selection of films you may enjoy:"
]

NO_RESULTS_TEMPLATES = [
    "No movies found for your criteria. Maybe you could relax some filters?",
    "Nothing matched your request. Try with something different.",
    "No results found for your query."
]

@register_step("response_generation.simple_response")
class OutputGenerator:

    def __init__(self, context: ExecutionContext):
        self.context = context

    def setup(self):
        self.df = self.context.get("hetrec_df")
        self.movie_details = self._precompute()

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

    def _format_movie(self, rank, row):
        imdb_url = f"https://www.imdb.com/title/tt{str(row.get('imdbID', '')).zfill(7)}/"
        audience  = f"{float(row['rtAudienceRating']):.1f}/5" if pd.notna(row.get('rtAudienceRating')) else "N/A"
        critics   = f"{float(row['rtAllCriticsRating']):.1f}/10" if pd.notna(row.get('rtAllCriticsRating')) else "N/A"

        lines = [
            f"{rank}. {row['title']} ({row['year']})",
            f"   Genres    : {row.get('genres', 'N/A')}",
            f"   Director  : {row.get('directors', 'N/A')}",
            f"   Audience  : {audience}  |  Critics: {critics}",
            f"   IMDb      : {imdb_url}",
        ]
        return "\n".join(lines)

    def run(self, data, state: State, user_model: UserModel):
        intent = state.current_intent
        if intent == "ask_info":
            return self.try_answer_query(data)
        elif intent == "fallback":
            return {"response": "I'm sorry, I couldn't understand your request. Could you please rephrase it easier?", "recommended_items": []}
        
        ranked_candidates = data.copy()
        if not isinstance(data, pd.DataFrame):
            return {"response": "Nothing to suggest! Could you ask for something more specific?", "recommended_items": []}
        elif data.empty:
            return {"response": random.choice(NO_RESULTS_TEMPLATES), "recommended_items": []}

        intro = random.choice(INTRO_TEMPLATES)
        lines = [intro, ""]

        for i, (_, row) in enumerate(ranked_candidates.iterrows(), start=1):
            movie_id = int(row['id'])
            details  = self.movie_details.loc[movie_id].to_dict() if movie_id in self.movie_details.index else {}
            merged   = {**details, **row.to_dict()}
            lines.append(self._format_movie(i, merged))
            lines.append("")

        return {"response": "\n".join(lines).strip(), "recommended_items": ranked_candidates.to_dict(orient="records")}
    
    def reset(self):
        pass

    # ------------------------------------------------------------------
    # Fixed-query patterns supported by try_answer_query
    #   "What are top rated movies?"
    #   "What are top rated movies from audience in <year>?"
    # ------------------------------------------------------------------
    _TOP_RATED_RE = re.compile(
        r"top[\s\-]?rated\s+movies",
        re.IGNORECASE,
    )
    _YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")

    def try_answer_query(self, data):
        query = data["query"]

        if self._TOP_RATED_RE.search(query):
            return self._answer_top_rated(query)

        return {
            "response": (
                "Sorry, I can only answer questions about top-rated movies right now. "
                "Try asking: \"What are top rated movies?\" or "
                "\"What are top rated movies from audience in 2005?\""
            ),
            "recommended_items": [],
        }

    def _answer_top_rated(self, query, n: int = 10):
        """Return the top-N movies by audience rating, optionally filtered by year."""
        df = self.movie_details.copy()
        df = df[pd.to_numeric(df["rtAudienceRating"], errors="coerce").notna()]
        df["rtAudienceRating"] = pd.to_numeric(df["rtAudienceRating"])

        year_match = self._YEAR_RE.search(query)
        year_filter = int(year_match.group(1)) if year_match else None

        if year_filter is not None:
            df = df[df["year"] == year_filter]
            if df.empty:
                return {
                    "response": f"No movies found for year {year_filter}.",
                    "recommended_items": [],
                }

        top = df.nlargest(n, "rtAudienceRating").reset_index()

        if year_filter:
            header = f"Here are the top {n} audience-rated movies from {year_filter}:\n"
        else:
            header = f"Here are the top {n} audience-rated movies of all time:\n"

        lines = [header]
        records = []
        for rank, (_, row) in enumerate(top.iterrows(), start=1):
            lines.append(self._format_movie(rank, row.to_dict()))
            lines.append("")
            records.append(row.to_dict())

        return {
            "response": "\n".join(lines).strip(),
            "recommended_items": records,
        }

    