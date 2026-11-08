# Recommending the Recommender: A Model-Based Design of Recommender Systems in the LLM Era - CAiSE 2027

This folder contains files for the paper: `Recommending the Recommender: A Model-Based Design of Recommender Systems in the LLM Era`



## Configurable Recommendation Framework

A modular framework to build, run and evaluate (conversational) recommender systems as a configurable 5-step pipeline:  
input processing → candidate selection → scoring → ranking → response generation.

### Installation

Requires Python 3.13 and [uv](https://docs.astral.sh/uv/).

```
uv sync
```

Extract `framework/datasets/hetrec_extracted.zip` into the same folder (it contains `hetrec_extracted.pkl`, required by both the pipeline and the evaluation).

Then set your credentials in `framework/.env`:

```
API_KEY=""
BASE_URL=""
```

### Usage

The recommendation pipeline lives in `framework/`.

Components are in `framework/components/`, one folder per stage: *input_processing/*, *candidate_selection/*, *scoring/*, *ranking/*, *response_generation/*

**Configuration.** The pipeline is built from `framework/config/schema.yaml`, which defines the registered names of the steps with their `params`.  
Ready-made configurations: `framework/config/Example_*.yaml` (traditional, SLM, LLM, agent). Copy one into `schema.yaml` to use it.


**Run the pipeline:**

```
uv run python -m framework.run
```

Add `--debug` for verbose logging. A ready-made VSCode launch configuration named **"framework"** is available in `.vscode/launch.json`.

**Run evaluation** (edit `INPUT_FILE_NAME` at the top of the script to pick the results file to evaluate):

```
uv run python framework/evaluate_deepeval.py
```

This will generate a file with the computed metrics, located in `framework/out/computed_results`

## Prompt examples

Prompt examples can be found in [prompts.md](prompts.md).
