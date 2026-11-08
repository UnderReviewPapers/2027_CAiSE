from framework.core.messages import Message
from framework.core.orchestrator import Orchestrator
from framework.core.run_log import PipelineRunLog
from framework.core.state import State
from framework.core.user_model import UserModel
from framework.registry.registry import register_orchestrator
import logging

logger = logging.getLogger(__name__)


@register_orchestrator("orchestrator.sequential_traditional_fb")
class SequentialPipelineWithFallback(Orchestrator):
    def __init__(self, steps, state, user_model, context, ask_info_step=None, fallback_step=None, side_steps=None):
        if ask_info_step is None or fallback_step is None:
            logger.warning("ask_info_step and fallback_step must be specified in config")
        self.steps = steps
        self.state: State = state
        self.user_model: UserModel = user_model
        self.context = context
        self.ask_info_step = ask_info_step
        self.fallback_step = fallback_step
        # side_steps: dict {name -> step_instance} for steps not in the pipeline
        self.side_steps: dict = side_steps or {}

    def reset(self):
        for step in self.steps:
            step.reset()
        self.state.reset()
        self.user_model.reset()

    def run(self, data) -> tuple:
        """Run the pipeline and return (result, run_log)."""
        run_log: PipelineRunLog = self.context.get("run_log")
        run_log.reset()

        self.state.update(Message(content=data["query"], role="user"))

        initial_step = self.steps[0]
        logger.debug("STEP: " + initial_step.__class__.__name__)
        step_name = getattr(initial_step, "step_name", initial_step.__class__.__name__)
        with run_log.record_step(step_name, type(initial_step).__name__):
            intent = initial_step.run(data, self.state, self.user_model)

        self.state.set_intent(intent)

        match intent:
            case "recommend":
                data = self._execute_pipeline(data, run_log, from_index=1)
            case "ask_info":
                step = self._find_step_by_name(self.ask_info_step)
                if step:
                    logger.debug(f"Routing ask_info to step: {step.__class__.__name__}")
                    sn = getattr(step, "step_name", step.__class__.__name__)
                    with run_log.record_step(sn, type(step).__name__):
                        data = step.run(data, self.state, self.user_model)
                else:
                    data = {"response": "ERR: cannot handle ask_info intent", "recommended_items": []}
            case _:
                step = self._find_step_by_name(self.fallback_step)
                if step:
                    logger.debug(f"Routing fallback to step: {step.__class__.__name__}")
                    sn = getattr(step, "step_name", step.__class__.__name__)
                    with run_log.record_step(sn, type(step).__name__):
                        data = step.run(data, self.state, self.user_model)
                else:
                    data = {"response": "ERR: cannot handle fallback intent", "recommended_items": []}

        self.state.update(Message(content=data, role="system"))
        return data, run_log

    def _execute_pipeline(self, data, run_log: PipelineRunLog, from_index=0):
        for step in self.steps[from_index:]:
            logger.debug("STEP: " + step.__class__.__name__)
            step_name = getattr(step, "step_name", step.__class__.__name__)
            with run_log.record_step(step_name, type(step).__name__):
                run_log.set_full_log_data_received(data)
                data = step.run(data, self.state, self.user_model)
                run_log.set_full_log_data_produced(data)
        return data

    def _find_step_by_name(self, step_name):
        if not step_name:
            return None
        # First look among the side-steps (not in the pipeline)
        if step_name in self.side_steps:
            return self.side_steps[step_name]
        # Then look in the pipeline
        for step in self.steps:
            if getattr(step, "step_name", None) == step_name:
                return step
        return None
