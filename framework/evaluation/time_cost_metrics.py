from collections import defaultdict

# ---------------------------------------------------------------------------
# Average time per step
# ---------------------------------------------------------------------------

def compute_step_time_metrics(records):
    """Returns, for each step_name, the average execution time (in
    seconds) computed over all queries in which the step is present.
    """
    print("computing step time")
    durations = defaultdict(list)

    for record in records:
        steps = record.get("run_log", {}).get("steps", [])
        for step in steps:
            durations[step["step_name"]].append(step["duration_s"])

    avg_times = {
        step_name: sum(values) / len(values)
        for step_name, values in durations.items()
    }
    return avg_times



# ---------------------------------------------------------------------------
# Token cost per step
# ---------------------------------------------------------------------------

def compute_step_token_metrics(records):
    """Returns, for each step_name that exposes agent_metrics, the total
    and average input_tokens / output_tokens / total_tokens.
    """
    print("computing step tokens")

    tokens = defaultdict(lambda: {"input": [], "output": [], "total": []})

    for record in records:
        steps = record.get("run_log", {}).get("steps", [])
        for step in steps:
            metrics = step.get("agent_metrics")
            if not metrics:
                continue
            name = step["step_name"]
            tokens[name]["input"].append(metrics.get("input_tokens", 0))
            tokens[name]["output"].append(metrics.get("output_tokens", 0))
            tokens[name]["total"].append(metrics.get("total_tokens", 0))

    result = {}
    for step_name, values in tokens.items():
        result[step_name] = {
            "n_llm_uses": len(values["input"]),# how many times the llm was used (not number of calls)
            "input_tokens_sum": sum(values["input"]),
            "input_tokens_avg": sum(values["input"]) / len(values["input"]),
            "output_tokens_sum": sum(values["output"]),
            "output_tokens_avg": sum(values["output"]) / len(values["output"]),
            "total_tokens_sum": sum(values["total"]),
            "total_tokens_avg": sum(values["total"]) / len(values["total"]),
        }
    return result
