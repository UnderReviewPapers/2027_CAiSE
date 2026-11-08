import json
import logging

logger = logging.getLogger(__name__)

def extract_json(text, caller):
    start = text.find('[')
    end = text.rfind(']')

    if start == -1 or end == -1:
        # raise ValueError("No JSON found")
        logger.error(f"No JSON found (in {caller})")
        return []

    json_str = text[start:end+1]
    return json.loads(json_str)

def extract_json_dict(text, caller):
    start = text.find('{')
    end = text.rfind('}')

    if start == -1 or end == -1:
        # raise ValueError("No JSON found")
        logger.error(f"No JSON found (in {caller})")
        return {}

    json_str = text[start:end+1]
    return json.loads(json_str)