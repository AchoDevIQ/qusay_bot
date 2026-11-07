from typing import List, Optional
from pydantic import BaseModel

class RubricObjective(BaseModel):
    id: str
    objective: str
    points: float

class Rubric(BaseModel):
    objectives: List[RubricObjective]
