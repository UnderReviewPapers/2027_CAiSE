from framework.core.orchestrator import Orchestrator
from framework.registry.registry import REGISTRY

from pathlib import Path
import importlib
import logging

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent


def _autodiscover_and_import():
    """
    Automatically imports all modules in:
    - framework.components
    - framework.orchestrators
    """

    for pkg in ("components", "orchestrators"):
        pkg_dir = BASE_DIR / pkg

        if not pkg_dir.exists():
            continue

        for py_file in pkg_dir.rglob("*.py"):

            if py_file.name == "__init__.py":
                continue

            rel_path = py_file.relative_to(BASE_DIR)

            module_name = (
                "framework."
                + str(rel_path.with_suffix("")).replace("/", ".").replace("\\", ".")
            )

            try:
                importlib.import_module(module_name)

            except Exception as e:
                logger.exception(f"Failed to import {module_name}: {e}")


def build_step(step_cfg, context):
    cls = REGISTRY["steps"][step_cfg["name"]]
    step_instance = cls(context=context, **step_cfg.get("params", {}))
    step_instance.step_name = step_cfg["name"]
    return step_instance


def build_orchestrator(cfg):
    return REGISTRY["orchestrators"][cfg["name"]]


def build_system(config, context)->Orchestrator:

    _autodiscover_and_import()

    steps = [build_step(s, context) for s in config["steps"]]

    for step in steps:
        step.setup()

    state = REGISTRY["states"][config["state"]["class"]]()

    user_model = REGISTRY["user_models"][config["user_model"]["class"]]()

    orch_cls = build_orchestrator(config["orchestrator"])

    orch_params = config["orchestrator"].get("params", {})

    # Build side-steps (e.g. fallback_step, ask_info_step) that are declared
    # in orchestrator params but are NOT part of the main pipeline.
    pipeline_names = {s.step_name for s in steps}
    side_step_keys = [k for k in orch_params if k.endswith("_step")]
    side_steps: dict = {}
    for key in side_step_keys:
        step_name = orch_params[key]
        if step_name and step_name not in pipeline_names:
            if step_name in REGISTRY["steps"]:
                side = build_step({"name": step_name}, context)
                side.setup()
                side_steps[step_name] = side
                logger.debug(f"Built side-step '{step_name}' for orchestrator param '{key}'")
            else:
                logger.warning(f"Side-step '{step_name}' (param '{key}') not found in registry")

    return orch_cls(steps, state, user_model, context, side_steps=side_steps, **orch_params)