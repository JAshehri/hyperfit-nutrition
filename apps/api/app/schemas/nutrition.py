from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class Sex(str, Enum):
    MALE = "MALE"
    FEMALE = "FEMALE"


class ActivityLevel(str, Enum):
    SEDENTARY = "SEDENTARY"
    LIGHT = "LIGHT"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class Goal(str, Enum):
    LOSS = "LOSS"
    GAIN = "GAIN"
    MAINTAIN = "MAINTAIN"
    SPECIAL = "SPECIAL"


class FormulaCode(str, Enum):
    MIFFLIN_ST_JEOR = "MIFFLIN_ST_JEOR"
    KATCH_MCARDLE = "KATCH_MCARDLE"


class MealSlotType(str, Enum):
    BREAKFAST = "BREAKFAST"
    LUNCH = "LUNCH"
    DINNER = "DINNER"
    SNACK = "SNACK"
    CUSTOM = "CUSTOM"


class MacroPercentages(BaseModel):
    protein_pct: Decimal = Field(ge=0, le=100)
    carb_pct: Decimal = Field(ge=0, le=100)
    fat_pct: Decimal = Field(ge=0, le=100)


class MealSlotInput(BaseModel):
    slot_type: MealSlotType
    display_name: str = Field(min_length=1, max_length=80)
    calorie_pct: Decimal = Field(gt=0, le=100)


def default_meal_slots() -> list[MealSlotInput]:
    return [
        MealSlotInput(slot_type="BREAKFAST", display_name="الفطور", calorie_pct=25),
        MealSlotInput(slot_type="LUNCH", display_name="الغداء", calorie_pct=40),
        MealSlotInput(slot_type="DINNER", display_name="العشاء", calorie_pct=25),
        MealSlotInput(slot_type="SNACK", display_name="سناك", calorie_pct=10),
    ]


class NutritionCalculationRequest(BaseModel):
    age: int = Field(ge=18, le=100)
    height_cm: Decimal = Field(ge=100, le=250)
    weight_kg: Decimal = Field(gt=0, le=500)
    body_fat_pct: Decimal = Field(gt=0, lt=100)
    sex: Sex
    activity_level: ActivityLevel
    goal: Goal
    formula_code: FormulaCode = FormulaCode.MIFFLIN_ST_JEOR
    calorie_adjustment: Decimal = Field(default=Decimal(500), ge=-2000, le=2000)
    macro_percentages: MacroPercentages | None = None
    meal_slots: list[MealSlotInput] = Field(default_factory=default_meal_slots, min_length=1)

class MacroResult(BaseModel):
    protein_g: Decimal
    carb_g: Decimal
    fat_g: Decimal
    protein_pct: Decimal
    carb_pct: Decimal
    fat_pct: Decimal


class MealTarget(BaseModel):
    slot_type: MealSlotType
    display_name: str
    calorie_pct: Decimal
    target_kcal: Decimal
    target_protein_g: Decimal
    target_carb_g: Decimal
    target_fat_g: Decimal


class NutritionCalculationResponse(BaseModel):
    formula_version: str
    lbm_kg: Decimal
    bmr_kcal: Decimal
    activity_factor: Decimal
    tdee_kcal: Decimal
    daily_target_kcal: Decimal
    macros: MacroResult
    meals: list[MealTarget]

