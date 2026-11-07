from pydantic import BaseModel
from typing import Literal

class GradingConfig(BaseModel):
    strictness: Literal["strict", "standard", "lenient"] = "standard"
    
    @property
    def propagated_error_multiplier(self) -> float:
        if self.strictness == "strict":
            return 0.0 # Strict mode gives 0 points for propagated errors
        elif self.strictness == "lenient":
            return 0.75 # Lenient mode gives 75% credit for correct methodology on wrong numbers
        return 0.5 # Standard gives 50%
        
    @property
    def partial_credit_multiplier(self) -> float:
        if self.strictness == "strict":
            return 0.0 # Must be completely correct
        elif self.strictness == "lenient":
            return 0.75
        return 0.5

    @property
    def reject_uncertainty(self) -> bool:
        return self.strictness == "strict"
