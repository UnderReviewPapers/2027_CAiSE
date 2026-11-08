from framework.core.run_log import PipelineRunLog


class ExecutionContext:
    def __init__(self, **resources):
        self._resources = resources
        # The run log is always present; orchestrators reset it each run.
        self._resources.setdefault("run_log", PipelineRunLog())

    def get(self, name):
        return self._resources[name]

    def __getattr__(self, name):
        return self._resources[name]