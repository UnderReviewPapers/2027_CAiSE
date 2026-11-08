from __future__ import annotations

import time
from dataclasses import dataclass, field
from contextlib import contextmanager
from typing import Any, Optional

from framework.core.agent_metric import AgentMetrics


@dataclass
class AgentMetricsSnapshot:
    """Immutable snapshot of an AgentMetrics instance."""
    llm_calls: int
    tool_calls: list[str]
    input_tokens: int
    output_tokens: int

    @classmethod
    def from_metrics(cls, metrics: AgentMetrics) -> "AgentMetricsSnapshot":
        return cls(
            llm_calls=metrics.llm_calls,
            tool_calls=list(metrics.tool_calls),
            input_tokens=metrics.input_tokens,
            output_tokens=metrics.output_tokens,
        )

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def to_dict(self) -> dict:
        return {
            "llm_calls": self.llm_calls,
            "tool_calls": self.tool_calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class StepRecord:
    """Execution data for a single pipeline step."""
    step_name: str
    step_class: str
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    agent_metrics: Optional[AgentMetricsSnapshot] = None
    # Extensible bag for any extra data a step wants to record.
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def duration_s(self) -> Optional[float]:
        if self.end_time is None:
            return None
        return round(self.end_time - self.start_time, 4)

    def finish(self) -> None:
        self.end_time = time.time()

    def set_agent_metrics(self, metrics: AgentMetrics) -> None:
        """Attach a snapshot of the given AgentMetrics to this record."""
        self.agent_metrics = AgentMetricsSnapshot.from_metrics(metrics)

    def set_hallucinated_items(self, num_remapped, num_not_matched, num_duplicates):
        self.extra["num_remapped"] = num_remapped
        self.extra["num_not_matched"] = num_not_matched
        self.extra["num_duplicates"] = num_duplicates

    def to_dict(self) -> dict:
        return {
            "step_name": self.step_name,
            "step_class": self.step_class,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_s": self.duration_s,
            "agent_metrics": self.agent_metrics.to_dict() if self.agent_metrics else None,
            **self.extra,
        }


class PipelineRunLog:
    """
    Collects StepRecords for one pipeline invocation.

    Stored in ExecutionContext under the key ``"run_log"``.
    Each orchestrator ``run()`` call should start with ``reset()``
    and can then use ``record_step()`` as a context manager.
    """

    def __init__(self) -> None:
        self._steps: list[StepRecord] = []
        self._current: Optional[StepRecord] = None
        self._received_data = None
        self._produced_data = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Clear all recorded steps (call at the start of every pipeline run)."""
        self._steps = []
        self._current = None
        self._received_data = None
        self._produced_data = None

    # ------------------------------------------------------------------
    # Recording API
    # ------------------------------------------------------------------

    @contextmanager
    def record_step(self, step_name: str, step_class: str):
        """
        Context manager that creates a StepRecord, makes it the current one,
        stops the timer on exit, and appends it to the log.

        Example::

            with run_log.record_step(step.step_name, type(step).__name__):
                data = step.run(data, state, user_model)
        """
        record = StepRecord(
            step_name=step_name,
            step_class=step_class,
            start_time=time.time(),
        )
        self._current = record
        try:
            yield record
        finally:
            record.finish()
            self._steps.append(record)
            if self._received_data is not None:
                record.extra["received_data"] = self._received_data
            if self._produced_data is not None:
                record.extra["produced_data"] = self._produced_data
            self._current = None

    @property
    def current_step(self) -> Optional[StepRecord]:
        """The StepRecord currently being recorded, or None."""
        return self._current

    def set_full_log_data_received(self, data):
        self._received_data = data

    def set_full_log_data_produced(self, data):
        self._produced_data = data

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    @property
    def steps(self) -> list[StepRecord]:
        return list(self._steps)

    def to_dict(self) -> dict:
        return {
            "steps": [s.to_dict() for s in self._steps],
        }
    
    def full_data_log_to_dict(self):
        return {
            "received_data": self._received_data,
            "produced_data": self._produced_data
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"PipelineRunLog(steps={len(self._steps)})"
