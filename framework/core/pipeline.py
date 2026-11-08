class Pipeline:
    def __init__(self, steps: list):
        self.steps = steps

    def run(self, data, state, user_model):
        for step in self.steps:
            res = step.run(data, state, user_model)
        return res