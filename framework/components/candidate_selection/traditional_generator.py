from anthropic.types.beta import beta_managed_agents_agent_tool_config_params
import pickle
import numpy as np
import scipy.sparse as sp
import implicit
import pandas as pd

from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step

@register_step("candidate_selection.traditional")
class ALSGenerator(Step):

    def __init__(self, context: ExecutionContext):
        self.context = context
        self.n_candidates = 20
        self.model = None
        self.item_enc = None
        self.item_dec = None
        self.n_items = None

    def setup(self):
        with open(self.context.get("als_model_path"), "rb") as f:
            export = pickle.load(f)

        self.model    = export["model"]
        self.item_enc = export["item_enc"]
        self.item_dec = export["item_dec"]
        self.n_items  = len(self.item_enc)

        config = export.get("config", {})
        self.rating_threshold = config.get("rating_threshold", 3.5)
        self.alpha            = config.get("alpha", 40)

        self.df = self.context.get("hetrec_df")

        movies = self.df['movies'][['id', 'title', 'year', 'rtAudienceRating']].copy()
        movies['year'] = pd.to_numeric(movies['year'], errors='coerce')
        movies['rtAudienceRating'] = pd.to_numeric(movies['rtAudienceRating'], errors='coerce')
        movies = movies.rename(columns={'rtAudienceRating': 'avg_rating'})

        self.movie_base = movies

        genres = self.df['movie_genres'][['movieID', 'genre']].copy()
        genres.columns = ['id', 'genre']
        self.genre_lookup = (   #{id: {genre1, genre2, ...}}
            genres.groupby('id')['genre']
            .apply(set)
            .to_dict()
        )

    def _build_user_vector(self, history: list) -> sp.csr_matrix:
        """Builds the user's confidence vector from their context."""
        cols, vals = [], []
        for entry in history:
            mid = entry["movieID"]
            rating = entry["rating"]

            # consistent with training: only "positive" interactions
            if rating < self.rating_threshold:
                continue
            if mid not in self.item_enc:
                continue

            cols.append(self.item_enc[mid])
            vals.append(float(1 + self.alpha * (rating - self.rating_threshold)))# confidence value

        return sp.csr_matrix(
            (vals, ([0] * len(cols), cols)),
            shape=(1, self.n_items)
        )

    def run(self, data, state: State, user_model: UserModel):
        results = []

        if user_model.interaction_history:
            results.append(self._run_ALS(user_model))

        if user_model.genres or user_model.year_range or user_model.min_rating:
            results.append(self._run_attribute_retriever(user_model))

        # if not results:
        #     return self._popularity_fallback()

        return (
            pd.concat(results)
            .drop_duplicates(subset="id")
            .reset_index(drop=True)
        )

    def _run_ALS(self, user_model: UserModel):
        history = user_model.interaction_history
        seen    = {entry["movieID"] for entry in history}

        user_vec = self._build_user_vector(history)

        # If nothing remains after the rating filter, no ALS recommendations
        if user_vec.nnz == 0:
            return pd.DataFrame(columns=["id", "als_score"])

        iids, scrs = self.model.recommend(
            userid=0,  # row 0 of the user_vec matrix (1 x n_items)
            user_items=user_vec,
            N=self.n_candidates + len(seen),
            filter_already_liked_items=False,
            recalculate_user=True,
        )

        results = [
            {"id": self.item_dec[i], "score": float(s)}
            for i, s in zip(iids, scrs)
            if self.item_dec[i] not in seen
        ][:self.n_candidates]

        return pd.DataFrame(results)
    
    def _run_attribute_retriever(self, user_model: UserModel):
        candidates = self.movie_base.copy()

        # filter: year within range
        if user_model.year_range is not None:
            lo, hi = user_model.year_range
            candidates = candidates[
                candidates['year'].between(lo, hi - 1)
            ]

        # filter: at least one requested genre present
        if user_model.genres:
            wanted = set(user_model.genres)
            mask = candidates['id'].map(
                lambda mid: bool(self.genre_lookup.get(mid, set()) & wanted)
            )
            candidates = candidates[mask]

        if user_model.min_rating is not None:
            candidates = candidates[
                candidates['avg_rating'] >= user_model.min_rating
            ]

        return candidates
    
    def reset(self):
        pass