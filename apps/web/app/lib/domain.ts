export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "HIGH" | "VERY_HIGH";
export type Goal = "LOSS" | "GAIN" | "MAINTAIN";
export type Sex = "MALE" | "FEMALE";
export type PlanStatus = "DRAFT" | "ACTIVE";

export type MealTarget = {
  slot_type: string;
  display_name: string;
  calorie_pct: string;
  target_kcal: string;
  target_protein_g: string;
  target_carb_g: string;
  target_fat_g: string;
};

export type NutritionResult = {
  formula_version: string;
  lbm_kg: string;
  bmr_kcal: string;
  activity_factor: string;
  tdee_kcal: string;
  daily_target_kcal: string;
  macros: {
    protein_g: string;
    carb_g: string;
    fat_g: string;
    protein_pct: string;
    carb_pct: string;
    fat_pct: string;
  };
  meals: MealTarget[];
};

export type Client = {
  id: string;
  name: string;
  phone: string;
  email: string;
  age: number;
  height: number;
  sex: Sex;
  weight: number;
  bodyFat: number;
  activity: ActivityLevel;
  goal: Goal;
  status: "ACTIVE" | "PAUSED";
  joinedAt: string;
  notes: string;
};

export type Food = {
  id: string;
  nameAr: string;
  category: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  state: string;
  mealTypes: string[];
};

export type GeneratedMeal = {
  id: string;
  slot: string;
  name: string;
  ingredients: string[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  completed: boolean;
  variant: number;
};

export type Plan = {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  updatedAt: string;
  status: PlanStatus;
  version: number;
  input: NutritionInput;
  result: NutritionResult;
  generatedMeals: GeneratedMeal[];
};

export type NutritionInput = {
  age: number;
  height: number;
  weight: number;
  bodyFat: number;
  sex: Sex;
  activity: ActivityLevel;
  goal: Goal;
  adjustment: number;
  macroPercentages?: { protein: number; carbs: number; fat: number };
  mealSlots: { name: string; pct: number }[];
  formula: "MIFFLIN_ST_JEOR" | "KATCH_MCARDLE";
};

export type AppSettings = {
  clinicName: string;
  doctorName: string;
  defaultAdjustment: number;
  notifications: boolean;
  language: "ar";
};

export type AppData = {
  clients: Client[];
  foods: Food[];
  plans: Plan[];
  settings: AppSettings;
};

const activityFactors: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  HIGH: 1.725,
  VERY_HIGH: 1.9,
};

const fixed = (value: number) => value.toFixed(3);

export function calculateNutrition(input: NutritionInput): NutritionResult {
  if (!Number.isInteger(input.age) || input.age < 18 || input.age > 100) throw new Error("العمر يجب أن يكون عددًا صحيحًا بين 18 و100");
  if (!(input.height >= 100 && input.height <= 250)) throw new Error("الطول يجب أن يكون بين 100 و250 سم");
  if (!(input.weight > 0 && input.weight <= 500)) throw new Error("الوزن يجب أن يكون بين 1 و500 كجم");
  if (!(input.bodyFat > 0 && input.bodyFat < 100)) throw new Error("نسبة الدهون يجب أن تكون بين 1 و99%");
  const mealTotal = input.mealSlots.reduce((sum, slot) => sum + slot.pct, 0);
  if (Math.abs(mealTotal - 100) > 0.001) throw new Error(`مجموع نسب الوجبات يجب أن يساوي 100%، والمجموع الحالي ${mealTotal}%`);

  const lbm = input.weight * (1 - input.bodyFat / 100);
  const bmr = input.formula === "MIFFLIN_ST_JEOR"
    ? 10 * input.weight + 6.25 * input.height - 5 * input.age + (input.sex === "MALE" ? 5 : -161)
    : 370 + 21.6 * lbm;
  const factor = activityFactors[input.activity];
  const tdee = bmr * factor;
  const adjustment = input.goal === "MAINTAIN" ? 0 : Math.abs(input.adjustment);
  const target = input.goal === "LOSS" ? tdee - adjustment : input.goal === "GAIN" ? tdee + adjustment : tdee;
  if (target < 900) throw new Error("هدف السعرات منخفض جدًا ويحتاج إلى مراجعة مختص قبل إنشاء الخطة");

  let proteinG: number;
  let carbG: number;
  let fatG: number;
  let proteinPct: number;
  let carbPct: number;
  let fatPct: number;
  if (input.macroPercentages) {
    const total = input.macroPercentages.protein + input.macroPercentages.carbs + input.macroPercentages.fat;
    if (Math.abs(total - 100) > 0.001) throw new Error(`مجموع الماكروز يجب أن يساوي 100%، والمجموع الحالي ${total}%`);
    proteinPct = input.macroPercentages.protein;
    carbPct = input.macroPercentages.carbs;
    fatPct = input.macroPercentages.fat;
    proteinG = target * proteinPct / 100 / 4;
    carbG = target * carbPct / 100 / 4;
    fatG = target * fatPct / 100 / 9;
  } else {
    proteinG = input.weight * (input.sex === "FEMALE" ? 1.8 : 2);
    fatG = input.weight * (input.sex === "FEMALE" ? 1 : 0.7);
    const carbKcal = target - proteinG * 4 - fatG * 9;
    if (carbKcal < 0) throw new Error("السعرات لا تكفي لاحتواء البروتين والدهون؛ عدّل الهدف أو النسب");
    carbG = carbKcal / 4;
    proteinPct = proteinG * 4 / target * 100;
    carbPct = carbKcal / target * 100;
    fatPct = fatG * 9 / target * 100;
  }

  return {
    formula_version: "hyperfit-v1-local",
    lbm_kg: fixed(lbm),
    bmr_kcal: fixed(bmr),
    activity_factor: String(factor),
    tdee_kcal: fixed(tdee),
    daily_target_kcal: fixed(target),
    macros: {
      protein_g: fixed(proteinG), carb_g: fixed(carbG), fat_g: fixed(fatG),
      protein_pct: fixed(proteinPct), carb_pct: fixed(carbPct), fat_pct: fixed(fatPct),
    },
    meals: input.mealSlots.map((slot, index) => {
      const ratio = slot.pct / 100;
      return {
        slot_type: ["BREAKFAST", "LUNCH", "DINNER", "SNACK"][index] ?? "CUSTOM",
        display_name: slot.name,
        calorie_pct: fixed(slot.pct),
        target_kcal: fixed(target * ratio),
        target_protein_g: fixed(proteinG * ratio),
        target_carb_g: fixed(carbG * ratio),
        target_fat_g: fixed(fatG * ratio),
      };
    }),
  };
}

const templates = [
  ["زبادي يوناني خالي الدسم", "موز", "لوز"],
  ["بيض كامل", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"],
  ["صدر دجاج مشوي بدون جلد", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"],
  ["سمك أبيض مشوي", "عدس مطبوخ", "بروكلي مطبوخ"],
  ["سلمون مطبوخ", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"],
  ["صدر ديك رومي", "تفاح", "لوز"],
  ["لحم بقري قليل الدهن", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"],
];

export function generateMeals(result: NutritionResult, foods: Food[], seed = 0): GeneratedMeal[] {
  if (!foods.length) throw new Error("قاعدة الأطعمة فارغة؛ أضف أطعمة قبل التوليد");
  return result.meals.map((target, index) => buildMeal(target, foods, seed + index));
}

export function regenerateMeal(target: MealTarget, foods: Food[], variant: number): GeneratedMeal {
  return buildMeal(target, foods, variant);
}

function buildMeal(target: MealTarget, foods: Food[], variant: number): GeneratedMeal {
  const allowed = foods.filter(food => food.mealTypes.includes(target.slot_type));
  if (!allowed.length) throw new Error(`لا توجد أطعمة مسموحة لنوع الوجبة ${target.display_name}`);
  const slotTemplates: Record<string, string[][]> = {
    BREAKFAST: [["بيض كامل", "زبادي يوناني خالي الدسم", "موز"], ["زبادي يوناني خالي الدسم", "تفاح", "لوز"]],
    LUNCH: [["صدر دجاج مشوي بدون جلد", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"], ["لحم بقري قليل الدهن", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"]],
    DINNER: [["سمك أبيض مشوي", "عدس مطبوخ", "بروكلي مطبوخ"], ["سلمون مطبوخ", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"]],
    SNACK: [["تفاح", "لوز"], ["موز", "زبادي يوناني خالي الدسم"]],
  };
  const choices = slotTemplates[target.slot_type] ?? templates;
  const template = choices[Math.abs(variant) % choices.length];
  const selected = template.map(name => allowed.find(food => food.nameAr === name)).filter(Boolean) as Food[];
  const usable = selected.length ? selected : allowed.slice(0, Math.min(3, allowed.length));
  const baseKcal = usable.reduce((sum, food) => sum + food.kcal, 0) || 1;
  const scale = Number(target.target_kcal) / baseKcal;
  const ingredients = usable.map(food => `${food.nameAr} — ${Math.max(20, Math.round(100 * scale / 5) * 5)} جم`);
  return {
    id: crypto.randomUUID(),
    slot: target.display_name,
    name: `وجبة ${target.display_name} المتوازنة`,
    ingredients,
    kcal: Math.round(Number(target.target_kcal)),
    protein: Number(target.target_protein_g),
    carbs: Number(target.target_carb_g),
    fat: Number(target.target_fat_g),
    completed: false,
    variant,
  };
}

export const seedFoods: Food[] = [
  ["صدر دجاج مشوي بدون جلد", "الدجاج واللحوم", 165, 31, 0, 3.6, "مطبوخ", ["LUNCH", "DINNER"]],
  ["فخذ دجاج بدون جلد", "الدجاج واللحوم", 209, 26, 0, 11, "مطبوخ", ["LUNCH", "DINNER"]],
  ["صدر ديك رومي", "الدجاج واللحوم", 135, 29, 0, 1.5, "مطبوخ", ["BREAKFAST", "LUNCH", "DINNER"]],
  ["لحم بقري قليل الدهن", "الدجاج واللحوم", 200, 26, 0, 10, "مطبوخ", ["LUNCH", "DINNER"]],
  ["سمك أبيض مشوي", "الأسماك", 120, 24, 0, 2, "مطبوخ", ["LUNCH", "DINNER"]],
  ["سلمون مطبوخ", "الأسماك", 206, 22, 0, 12, "مطبوخ", ["LUNCH", "DINNER"]],
  ["بيض كامل", "البيض", 143, 12.6, .7, 9.5, "كما يؤكل", ["BREAKFAST", "DINNER"]],
  ["زبادي يوناني خالي الدسم", "الألبان", 59, 10, 3.6, .4, "كما يؤكل", ["BREAKFAST", "SNACK"]],
  ["أرز بسمتي مطبوخ", "الحبوب", 130, 3, 28, .3, "مطبوخ", ["LUNCH", "DINNER"]],
  ["عدس مطبوخ", "البقوليات", 116, 9, 20, .4, "مطبوخ", ["LUNCH", "DINNER"]],
  ["بروكلي مطبوخ", "الخضار", 35, 2.4, 7, .4, "مطبوخ", ["LUNCH", "DINNER"]],
  ["تفاح", "الفواكه", 52, .3, 13.8, .2, "كما يؤكل", ["BREAKFAST", "SNACK"]],
  ["موز", "الفواكه", 89, 1.1, 22.8, .3, "كما يؤكل", ["BREAKFAST", "SNACK"]],
  ["لوز", "المكسرات", 579, 21, 22, 50, "كما يؤكل", ["BREAKFAST", "SNACK"]],
  ["زيت زيتون", "الدهون", 884, 0, 0, 100, "كما يؤكل", ["LUNCH", "DINNER"]],
].map(([nameAr, category, kcal, protein, carbs, fat, state, mealTypes], index) => ({
  id: `food-${index + 1}`, nameAr: String(nameAr), category: String(category), kcal: Number(kcal),
  protein: Number(protein), carbs: Number(carbs), fat: Number(fat), state: String(state), mealTypes: mealTypes as string[],
}));

export const initialData: AppData = {
  clients: [],
  foods: seedFoods,
  plans: [],
  settings: { clinicName: "HyperFit Nutrition", doctorName: "د. ريم الناصر", defaultAdjustment: 500, notifications: true, language: "ar" },
};

export const STORAGE_KEY = "hyperfit-functional-v2";
