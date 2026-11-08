import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class ResultSaver:
    def __init__(self):
        self.results = {}
        self.full_data_logs = {}
        self.out_dir = Path(__file__).resolve().parent.parent / "out"
        
    def save_result(self, test_id, query_id, query, interaction_history, intent_type, result, run_log):
        if test_id not in self.results:
            self.results[test_id] = {}
        self.results[test_id][query_id] = {
            "query": query,
            "interaction_history": interaction_history,
            "intent_type": intent_type,
            "result": result,
            "run_log": run_log
        }
    
    def save_full_log_data(self, full_data_log_dict):
        self.full_data_logs = full_data_log_dict

        
    def save_to_json(self, cfg, filename, extra=None):
        """Save run config, results and optional full data log to a JSON file."""
        run_config = {
            "steps": cfg["steps"],
            "orchestrator": cfg["orchestrator"]
            }
        if not self.out_dir.exists():
            self.out_dir.mkdir()
        path = self.out_dir / f"out_{filename}"

        dict_to_save = {
            "run_config": run_config,
            "results": self.results
        }
        if extra:
            dict_to_save.update(extra)
        if self.full_data_logs:
            dict_to_save["full_data_log"] = self.full_data_logs
        with open(path, "w") as f:
            json.dump(dict_to_save, f, indent=4, default=str)
        
        logger.info(f"Results saved to {path}")