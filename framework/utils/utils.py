import logging
from rapidfuzz import process as fuzz_process, fuzz
import pandas as pd

logger = logging.getLogger(__name__)


def remap_ids_by_title(
        scores_df: pd.DataFrame,
        movies_ref: pd.DataFrame,
        score_cutoff: float = 90.0,
    ) -> pd.DataFrame:
        """Overwrite the `id` column in scores_df by fuzzy-matching `title`
        against self.df["movies"].
        Returns the number of remapped rows and the number of movies with no match in the df.
        """
        if "title" not in scores_df.columns or "title" not in movies_ref.columns:
            return scores_df

        num_remapped, num_not_matched = 0, 0
        # Build a lookup: title -> correct id from the full movies table
        ref_titles = movies_ref["title"].astype(str).tolist()
        ref_ids = movies_ref["id"].astype(str).tolist()
        title_to_id = dict(zip(ref_titles, ref_ids))

        remapped_ids = []
        for _, row in scores_df.iterrows():
            llm_title = str(row.get("title", ""))
            match = fuzz_process.extractOne(
                llm_title,
                ref_titles,
                scorer=fuzz.WRatio,
                score_cutoff=score_cutoff,
            )
            if match:
                correct_id = title_to_id[match[0]]
                if correct_id != row["id"]:
                    logger.debug(
                        "AgentScorer: remapped id %s -> %s for title '%s' (matched '%s', score=%.1f)",
                        row["id"], correct_id, llm_title, match[0], match[1],
                    )
                    num_remapped += 1
                remapped_ids.append(correct_id)
            else:
                # No confident match – keep original id and log a warning
                logger.warning(
                    "AgentScorer: no title match for '%s' (id=%s), keeping original id",
                    llm_title, row["id"],
                )
                num_not_matched += 1
                remapped_ids.append(row["id"])

        scores_df = scores_df.copy()
        scores_df["id"] = remapped_ids
        return scores_df, num_remapped, num_not_matched

def drop_and_count_duplicates_by_title(candidates: pd.DataFrame):
    num_duplicates = candidates.duplicated(subset=["title"]).sum()
    candidates = candidates.drop_duplicates(subset=["title"])
    return candidates, num_duplicates


def fuzzy_normalize_titles(df: pd.DataFrame, ref_titles: list, score_cutoff: float = 90.0) -> pd.DataFrame:
    """Replace each title in df with the closest fuzzy match from ref_titles.
    Unmatched titles are left unchanged.
    """
    normalized = []
    for _, row in df.iterrows():
        title = str(row.get("title", ""))
        match = fuzz_process.extractOne(title, ref_titles, scorer=fuzz.WRatio, score_cutoff=score_cutoff)
        normalized.append(match[0] if match else title)
    df = df.copy()
    df["title"] = normalized
    return df