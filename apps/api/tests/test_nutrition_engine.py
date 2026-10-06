from decimal import Decimal

import pytest

from app.domain.nutrition.engine import NutritionValidationError, calculate_nutrition
from app.schemas.nutrition import NutritionCalculationRequest


def base_payload(**overrides):
    values = {
        "age": 31,
        "height_cm": 178,
        "weight_kg": 80,
        "body_fat_pct": 15,
        "sex": "MALE",
        "activity_level": "MODERATE",
        "goal": "LOSS",
        "calorie_adjustment": 500,
    }
    values.update(overrides)
    return NutritionCalculationRequest(**values)


def test_reference_case_male_loss():
    result = calculate_nutrition(base_payload())

    assert result.lbm_kg == Decimal("68.000")
    assert result.bmr_kcal == Decimal("1762.500")
    assert result.tdee_kcal == Decimal("2731.875")
    assert result.daily_target_kcal == Decimal("2231.875")
    assert result.macros.protein_g == Decimal("160.000")
    assert result.macros.fat_g == Decimal("56.000")
    assert result.macros.carb_g == Decimal("271.969")
    assert sum(meal.target_kcal for meal in result.meals) == Decimal("2231.875")


def test_doctor_macro_percentages_are_converted_to_grams():
    result = calculate_nutrition(
        base_payload(macro_percentages={"protein_pct": 30, "carb_pct": 40, "fat_pct": 30})
    )

    assert result.macros.protein_pct == Decimal("30.000")
    assert result.macros.protein_g == Decimal("167.391")
    assert result.macros.fat_g == Decimal("74.396")


def test_rejects_invalid_meal_percent_sum():
    payload = base_payload(
        meal_slots=[
            {"slot_type": "BREAKFAST", "display_name": "الفطور", "calorie_pct": 20},
            {"slot_type": "LUNCH", "display_name": "الغداء", "calorie_pct": 50},
        ]
    )

    with pytest.raises(NutritionValidationError) as exc:
        calculate_nutrition(payload)

    assert exc.value.code == "MEAL_PERCENT_SUM_INVALID"


def test_rejects_negative_carbohydrate_result():
    with pytest.raises(NutritionValidationError) as exc:
        calculate_nutrition(base_payload(weight_kg=250, body_fat_pct=90, calorie_adjustment=2000))

    assert exc.value.code in {"NEGATIVE_CARB_RESULT", "DAILY_TARGET_INVALID"}


def test_maintain_ignores_default_calorie_adjustment():
    payload = NutritionCalculationRequest(
        age=31,
        height_cm=178,
        weight_kg=80,
        body_fat_pct=15,
        sex="MALE",
        activity_level="MODERATE",
        goal="MAINTAIN",
    )

    result = calculate_nutrition(payload)

    assert result.daily_target_kcal == result.tdee_kcal

