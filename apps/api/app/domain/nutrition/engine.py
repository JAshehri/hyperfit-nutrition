from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.schemas.nutrition import (
    ActivityLevel,
    FormulaCode,
    Goal,
    MacroResult,
    MealTarget,
    NutritionCalculationRequest,
    NutritionCalculationResponse,
    Sex,
)

ACTIVITY_FACTORS: dict[ActivityLevel, Decimal] = {
    ActivityLevel.SEDENTARY: Decimal("1.2"),
    ActivityLevel.LIGHT: Decimal("1.375"),
    ActivityLevel.MODERATE: Decimal("1.55"),
    ActivityLevel.HIGH: Decimal("1.725"),
    ActivityLevel.VERY_HIGH: Decimal("1.9"),
}

ONE_HUNDRED = Decimal(100)
FOUR = Decimal(4)
NINE = Decimal(9)
INTERNAL_QUANTUM = Decimal("0.001")


class NutritionValidationError(ValueError):
    def __init__(self, code: str, message_ar: str, details: dict[str, Any] | None = None):
        super().__init__(message_ar)
        self.code = code
        self.message_ar = message_ar
        self.details = details or {}


def _d(value: Decimal | float | str) -> Decimal:
    return Decimal(str(value))


def _q(value: Decimal) -> Decimal:
    return value.quantize(INTERNAL_QUANTUM, rounding=ROUND_HALF_UP)


def _assert_percent_sum(values: list[Decimal], code: str, label: str) -> None:
    total = sum(values, Decimal(0))
    if abs(total - ONE_HUNDRED) > Decimal("0.001"):
        raise NutritionValidationError(
            code,
            f"يجب أن يساوي مجموع نسب {label} 100%",
            {"sum": str(total)},
        )


def _default_macros(weight_kg: Decimal, sex: Sex, daily_target: Decimal) -> MacroResult:
    if sex is Sex.FEMALE:
        protein_g = weight_kg * Decimal("1.8")
        fat_g = weight_kg * Decimal("1.0")
    else:
        protein_g = weight_kg * Decimal("2.0")
        fat_g = weight_kg * Decimal("0.7")

    protein_kcal = protein_g * FOUR
    fat_kcal = fat_g * NINE
    carb_kcal = daily_target - protein_kcal - fat_kcal
    if carb_kcal < 0:
        raise NutritionValidationError(
            "NEGATIVE_CARB_RESULT",
            "هدف السعرات لا يستطيع احتواء البروتين والدهون الافتراضيين",
            {"carb_kcal": str(carb_kcal)},
        )

    carb_g = carb_kcal / FOUR
    return MacroResult(
        protein_g=_q(protein_g),
        carb_g=_q(carb_g),
        fat_g=_q(fat_g),
        protein_pct=_q(protein_kcal / daily_target * ONE_HUNDRED),
        carb_pct=_q(carb_kcal / daily_target * ONE_HUNDRED),
        fat_pct=_q(fat_kcal / daily_target * ONE_HUNDRED),
    )


def _doctor_macros(payload: NutritionCalculationRequest, daily_target: Decimal) -> MacroResult:
    assert payload.macro_percentages is not None
    p = _d(payload.macro_percentages.protein_pct)
    c = _d(payload.macro_percentages.carb_pct)
    f = _d(payload.macro_percentages.fat_pct)
    _assert_percent_sum([p, c, f], "MACRO_PERCENT_SUM_INVALID", "الماكروز")
    return MacroResult(
        protein_g=_q((daily_target * p / ONE_HUNDRED) / FOUR),
        carb_g=_q((daily_target * c / ONE_HUNDRED) / FOUR),
        fat_g=_q((daily_target * f / ONE_HUNDRED) / NINE),
        protein_pct=_q(p),
        carb_pct=_q(c),
        fat_pct=_q(f),
    )


def calculate_nutrition(payload: NutritionCalculationRequest) -> NutritionCalculationResponse:
    weight = _d(payload.weight_kg)
    body_fat = _d(payload.body_fat_pct)
    adjustment = _d(payload.calorie_adjustment)
    factor = ACTIVITY_FACTORS[payload.activity_level]

    lbm = weight * (Decimal(1) - body_fat / ONE_HUNDRED)
    if payload.formula_code is FormulaCode.MIFFLIN_ST_JEOR:
        sex_offset = Decimal(5) if payload.sex is Sex.MALE else Decimal(-161)
        bmr = (
            Decimal(10) * weight
            + Decimal("6.25") * _d(payload.height_cm)
            - Decimal(5) * _d(payload.age)
            + sex_offset
        )
    else:
        bmr = Decimal(370) + Decimal("21.6") * lbm
    tdee = bmr * factor

    if payload.goal is Goal.LOSS:
        daily_target = tdee - abs(adjustment)
    elif payload.goal is Goal.GAIN:
        daily_target = tdee + abs(adjustment)
    elif payload.goal is Goal.MAINTAIN:
        # A maintenance plan must never inherit the schema's loss/gain default.
        daily_target = tdee
    else:
        daily_target = tdee + adjustment

    if daily_target <= 0:
        raise NutritionValidationError(
            "DAILY_TARGET_INVALID",
            "يجب أن يكون هدف السعرات اليومي أكبر من صفر",
            {"daily_target_kcal": str(daily_target)},
        )

    macros = (
        _doctor_macros(payload, daily_target)
        if payload.macro_percentages
        else _default_macros(weight, payload.sex, daily_target)
    )

    meal_percentages = [_d(slot.calorie_pct) for slot in payload.meal_slots]
    _assert_percent_sum(meal_percentages, "MEAL_PERCENT_SUM_INVALID", "الوجبات")

    meals = []
    allocated_kcal = Decimal(0)
    allocated_protein = Decimal(0)
    allocated_carb = Decimal(0)
    allocated_fat = Decimal(0)
    last_index = len(payload.meal_slots) - 1
    for index, slot in enumerate(payload.meal_slots):
        pct = _d(slot.calorie_pct)
        ratio = pct / ONE_HUNDRED
        if index == last_index:
            target_kcal = _q(daily_target) - allocated_kcal
            target_protein = macros.protein_g - allocated_protein
            target_carb = macros.carb_g - allocated_carb
            target_fat = macros.fat_g - allocated_fat
        else:
            target_kcal = _q(daily_target * ratio)
            target_protein = _q(macros.protein_g * ratio)
            target_carb = _q(macros.carb_g * ratio)
            target_fat = _q(macros.fat_g * ratio)
            allocated_kcal += target_kcal
            allocated_protein += target_protein
            allocated_carb += target_carb
            allocated_fat += target_fat
        meals.append(
            MealTarget(
                slot_type=slot.slot_type,
                display_name=slot.display_name,
                calorie_pct=_q(pct),
                target_kcal=target_kcal,
                target_protein_g=target_protein,
                target_carb_g=target_carb,
                target_fat_g=target_fat,
            )
        )

    return NutritionCalculationResponse(
        formula_version=f"hyperfit-v2-{payload.formula_code.value.lower()}",
        lbm_kg=_q(lbm),
        bmr_kcal=_q(bmr),
        activity_factor=factor,
        tdee_kcal=_q(tdee),
        daily_target_kcal=_q(daily_target),
        macros=macros,
        meals=meals,
    )

