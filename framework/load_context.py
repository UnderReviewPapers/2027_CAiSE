from framework.core.execution_context import ExecutionContext
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

def import_data(dataset_name):
    import pickle
    with open(BASE_DIR / "datasets" / dataset_name, "rb") as f:
        dataframes = pickle.load(f)
    return dataframes


def load_execution_context():
    return ExecutionContext(
        hetrec_df=import_data("hetrec_extracted.pkl"),
        als_model_path=BASE_DIR / "datasets" / "ALS_model_hetrec_test_set_TH(3.5)_USERS(5)_CTX(25)_TGT(10).pkl",
    )
