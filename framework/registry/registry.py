REGISTRY = {
    "steps": {},
    "orchestrators": {},
    "states": {},
    "user_models": {}
}

def register_step(name):
    def wrapper(cls):
        REGISTRY["steps"][name] = cls
        return cls
    return wrapper

def register_orchestrator(name):
    def wrapper(cls):
        REGISTRY["orchestrators"][name] = cls
        return cls
    return wrapper

def register_state(name):
    def wrapper(cls):
        REGISTRY["states"][name] = cls
        return cls
    return wrapper

def register_user_model(name):
    def wrapper(cls):
        REGISTRY["user_models"][name] = cls
        return cls
    return wrapper