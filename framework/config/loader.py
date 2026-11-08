from pathlib import Path
import yaml
import json


CONFIG_DIR = Path(__file__).resolve().parent

def load_config():
    cfg_path = CONFIG_DIR / "schema.yaml"

    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_queries(file_name: str) -> dict:
    queries_path = CONFIG_DIR / file_name

    with open(queries_path, "r", encoding="utf-8") as f:
        return json.load(f)