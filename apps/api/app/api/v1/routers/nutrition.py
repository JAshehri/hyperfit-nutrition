from fastapi import APIRouter

from app.domain.nutrition.engine import calculate_nutrition
from app.schemas.nutrition import NutritionCalculationRequest, NutritionCalculationResponse

router = APIRouter()


@router.post("/calculate", response_model=NutritionCalculationResponse)
def calculate(payload: NutritionCalculationRequest) -> NutritionCalculationResponse:
    return calculate_nutrition(payload)

