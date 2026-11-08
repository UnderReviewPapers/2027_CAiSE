from framework.core.execution_context import ExecutionContext
from framework.core.state import State
from framework.core.step import Step
from framework.core.user_model import UserModel
from framework.registry.registry import register_step
from sklearn.preprocessing import MinMaxScaler
import pandas as pd
import numpy as np

@register_step("scoring.traditional")
class SimpleScorer(Step):

    def __init__(self, context: ExecutionContext, weights=None):
        self.context = context
        self.weights = weights or {
            "audience_rating": 0.4,
            "critics_rating": 0.3,
            "popularity": 0.3,
        }

    def setup(self):
        self.df = self.context.get("hetrec_df")

        # Flag: if True and the candidates have a "score" column (e.g. from ALS),
        # use it as an additional component of the final scoring.
        self.use_input_score = True
        self.input_score_weight = 0.3

        self._precompute()

    def _precompute(self):
        movies = self.df['movies'][['id', 'rtAudienceRating', 'rtAllCriticsRating', 'rtAudienceNumRatings']].copy()
        for col in ['rtAudienceRating', 'rtAllCriticsRating', 'rtAudienceNumRatings']:
            movies[col] = pd.to_numeric(movies[col], errors='coerce')

        movies['rtAudienceNumRatings'] = np.log1p(movies['rtAudienceNumRatings'])

        scaler = MinMaxScaler()
        normalized = scaler.fit_transform(
            movies[['rtAudienceRating', 'rtAllCriticsRating', 'rtAudienceNumRatings']].fillna(0)
        )

        movies[['audience_rating_norm', 'critics_rating_norm', 'popularity_norm']] = normalized
        self.movie_scores = movies[['id', 'audience_rating_norm', 'critics_rating_norm', 'popularity_norm']].set_index('id')

    def run(self, data, state: State, user_model: UserModel):
        candidates = data.copy()
        candidates['id'] = candidates['id'].astype(int)
        ids = candidates['id'].values
        scores = self.movie_scores.reindex(ids).fillna(0)

        w = self.weights
        base_score = (
            w['audience_rating'] * scores['audience_rating_norm'] +
            w['critics_rating']  * scores['critics_rating_norm']  +
            w['popularity']      * scores['popularity_norm']
        ).values

        # Optional component: input score (e.g. ALS), if present and enabled
        if self.use_input_score and 'score' in candidates.columns:
            input_score = candidates['score'].fillna(0).values.astype(float)

            # min-max normalize the input score to bring it into [0,1]
            min_s, max_s = input_score.min(), input_score.max()
            if max_s > min_s:
                input_score_norm = (input_score - min_s) / (max_s - min_s)
            else:
                input_score_norm = np.zeros_like(input_score)

            # renormalize the base weights so the total sum stays 1
            remaining_weight = 1.0 - self.input_score_weight
            total_base_weight = sum(w.values())
            base_score_scaled = base_score * (remaining_weight / total_base_weight) if total_base_weight > 0 else base_score

            final_score = base_score_scaled + self.input_score_weight * input_score_norm
        else:
            final_score = base_score

        result = candidates.copy()
        result['score'] = final_score
        return result

    def reset(self):
        pass