from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from langchain_core.agents import AgentAction
from typing import Any


class AgentMetrics(BaseCallbackHandler):

    def reset(self):
        self.llm_calls = 0
        self.tool_calls: list[str] = []
        self.input_tokens = 0
        self.output_tokens = 0

    def __init__(self):
        self.reset()

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        self.llm_calls += 1
        for generations in response.generations:
            for gen in generations:
                # usage_metadata is on AIMessage, standard LangChain field
                usage = getattr(gen.message, "usage_metadata", None)
                if usage:
                    self.input_tokens  += usage.get("input_tokens", 0)
                    self.output_tokens += usage.get("output_tokens", 0)

    def on_tool_start(self, serialized: dict, input_str: str, **kwargs: Any) -> None:
        self.tool_calls.append(serialized.get("name", "?"))

    def summary(self) -> str:
        tools = ", ".join(self.tool_calls) if self.tool_calls else "—"
        return (
            f"llm_calls={self.llm_calls} | "
            f"tool_calls={len(self.tool_calls)} [{tools}] | "
            f"tokens={self.input_tokens + self.output_tokens} "
            f"(in={self.input_tokens}, out={self.output_tokens})"
        )