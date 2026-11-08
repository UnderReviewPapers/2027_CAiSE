from framework.core.user_model import UserModel
from framework.registry.registry import register_user_model

@register_user_model("user_model.simple")
class SimpleUserModel(UserModel):
    def __init__(self):
        self.genres = []
        self.year_range = None
        self.min_rating = None
        self.interaction_history = []

    def update(self, new_input):
        for key, value in new_input.items():
            if value is not None and value != []:
                setattr(self, key, value)

    def reset(self):
        self.genres = []
        self.year_range = None
        self.min_rating = None
        self.interaction_history = []
    
    def __str__(self):
        return (
            f"User Model(\n"
            f"  genres={self.genres},\n"
            f"  year_range={self.year_range},\n"
            f"  min_rating={self.min_rating}\n"
            f"  interaction_history={self.interaction_history}\n"
            f")"
        )