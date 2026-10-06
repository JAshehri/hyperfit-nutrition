from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.v1.routers.auth import current_user, require_staff
from app.database import audit, connect, transaction
from app.security import now_iso


router = APIRouter()


class StatePayload(BaseModel):
    data: dict[str, Any]
    version: int | None = None


class MealCompletionPayload(BaseModel):
    plan_id: str
    meal_id: str
    completed: bool


class MealAlternativePayload(BaseModel):
    plan_id: str
    meal_id: str


def validate_plan_collection(current_data: dict[str, Any] | None, next_data: dict[str, Any]) -> None:
    plans = next_data.get("plans", [])
    if not isinstance(plans, list):
        raise HTTPException(status_code=422, detail="صيغة الخطط غير صحيحة")
    plan_ids = [plan.get("id") for plan in plans]
    if any(not plan_id for plan_id in plan_ids) or len(plan_ids) != len(set(plan_ids)):
        raise HTTPException(status_code=422, detail="معرّفات الخطط مفقودة أو مكررة")

    allowed_statuses = {"DRAFT", "ACTIVE"}
    for plan in plans:
        if plan.get("status") not in allowed_statuses or not plan.get("clientId"):
            raise HTTPException(status_code=422, detail="حالة الخطة أو العميل غير صحيحة")

    for client_id in {plan.get("clientId") for plan in plans}:
        client_plans = [plan for plan in plans if plan.get("clientId") == client_id]
        pending_count = sum(plan.get("status") == "DRAFT" for plan in client_plans)
        active_count = sum(plan.get("status") == "ACTIVE" for plan in client_plans)
        if pending_count > 1:
            raise HTTPException(status_code=409, detail="يسمح بمسودة واحدة فقط لكل عميل")
        if active_count > 1:
            raise HTTPException(status_code=409, detail="يسمح بخطة فعالة واحدة فقط لكل عميل")

    if not current_data:
        if any(plan.get("status") == "ACTIVE" for plan in plans):
            raise HTTPException(status_code=409, detail="يجب إنشاء الخطة كمسودة ثم اعتمادها عبر الإجراء المخصص")
        return

    current_plans = {plan.get("id"): plan for plan in current_data.get("plans", [])}
    next_plans = {plan.get("id"): plan for plan in plans}
    for plan_id, plan in next_plans.items():
        stored = current_plans.get(plan_id)
        if not stored:
            if plan.get("status") != "DRAFT":
                raise HTTPException(status_code=409, detail="لا يمكن إنشاء خطة فعالة مباشرة")
            continue
        old_status = stored.get("status")
        new_status = plan.get("status")
        if old_status == "ACTIVE" and new_status != old_status:
            raise HTTPException(status_code=409, detail="الخطة الفعالة للقراءة فقط ولا تعدّل مباشرة")
        if old_status == "DRAFT" and new_status == "ACTIVE":
            raise HTTPException(status_code=409, detail="استخدم إجراء اعتماد المسودة المخصص")

    for plan_id, stored in current_plans.items():
        if plan_id not in next_plans:
            raise HTTPException(status_code=409, detail="لا يمكن حذف خطة محفوظة مباشرة")


def persist_plan_action(database, data: dict[str, Any], user: dict, action: str, plan_id: str) -> dict:
    row = database.execute("SELECT version FROM application_state WHERE id = 1").fetchone()
    next_version = row["version"] + 1
    timestamp = now_iso()
    database.execute(
        "UPDATE application_state SET payload = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1",
        (json.dumps(data, ensure_ascii=False), next_version, user["id"], timestamp),
    )
    audit(database, user["id"], action, "PLAN", plan_id, {"version": next_version}, timestamp)
    return {"data": data, "version": next_version, "updated_at": timestamp}


@router.get("")
def get_state(user: Annotated[dict, Depends(current_user)]) -> dict:
    with connect() as database:
        row = database.execute("SELECT payload, version, updated_at FROM application_state WHERE id = 1").fetchone()
    if not row:
        return {"data": None, "version": 0, "updated_at": None}
    data = json.loads(row["payload"])
    if user["role"] == "CLIENT":
        clients = [client for client in data.get("clients", []) if client.get("email", "").lower() == user["email"].lower()]
        client_ids = {client.get("id") for client in clients}
        data = {
            **data,
            "clients": clients,
            "plans": [plan for plan in data.get("plans", []) if plan.get("clientId") in client_ids],
        }
    return {"data": data, "version": row["version"], "updated_at": row["updated_at"]}


@router.put("")
def save_state(payload: StatePayload, user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in {"DOCTOR", "ADMIN"}:
        raise HTTPException(status_code=403, detail="المستخدم لا يملك صلاحية تعديل بيانات النظام")
    timestamp = now_iso()
    with transaction() as database:
        current = database.execute("SELECT version FROM application_state WHERE id = 1").fetchone()
        current_version = current["version"] if current else 0
        if payload.version is not None and payload.version != current_version:
            raise HTTPException(status_code=409, detail="تم تعديل البيانات من جلسة أخرى؛ حدّث الصفحة ثم أعد المحاولة")
        next_version = current_version + 1
        data_to_save = payload.data
        current_data = json.loads(database.execute("SELECT payload FROM application_state WHERE id = 1").fetchone()["payload"]) if current else None
        validate_plan_collection(current_data, data_to_save)
        if current_data:
            current_plans = {plan.get("id"): plan for plan in current_data.get("plans", [])}
            protected_plans = []
            for submitted_plan in data_to_save.get("plans", []):
                stored_plan = current_plans.get(submitted_plan.get("id"))
                if stored_plan and stored_plan.get("status") == "ACTIVE":
                    submitted_plan = stored_plan
                protected_plans.append(submitted_plan)
            data_to_save = {**data_to_save, "plans": protected_plans}
        database.execute(
            """INSERT INTO application_state (id, payload, version, updated_by, updated_at)
               VALUES (1, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 payload = excluded.payload, version = excluded.version,
                 updated_by = excluded.updated_by, updated_at = excluded.updated_at""",
            (json.dumps(data_to_save, ensure_ascii=False), next_version, user["id"], timestamp),
        )
        audit(database, user["id"], "APPLICATION_STATE_UPDATED", "APPLICATION_STATE", "1", {"version": next_version}, timestamp)
    return {"version": next_version, "updated_at": timestamp}


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: str, user: Annotated[dict, Depends(require_staff)]) -> dict:
    with transaction() as database:
        row = database.execute("SELECT payload FROM application_state WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="لا توجد بيانات غذائية")
        data = json.loads(row["payload"])
        plan = next((item for item in data.get("plans", []) if item.get("id") == plan_id), None)
        if not plan:
            raise HTTPException(status_code=404, detail="الخطة غير موجودة")
        if plan.get("status") != "DRAFT" or not plan.get("generatedMeals"):
            raise HTTPException(status_code=409, detail="يجب حفظ المسودة وتوليد وجباتها قبل الاعتماد")
        active_plans = [
            item for item in data.get("plans", [])
            if item.get("id") != plan_id
            and item.get("clientId") == plan.get("clientId")
            and item.get("status") == "ACTIVE"
        ]
        if len(active_plans) > 1:
            raise HTTPException(status_code=409, detail="بيانات العميل تحتوي أكثر من خطة فعالة وتحتاج مراجعة")
        replaced_ids = {active_plan.get("id") for active_plan in active_plans}
        data["plans"] = [item for item in data.get("plans", []) if item.get("id") not in replaced_ids]
        plan["status"] = "ACTIVE"
        plan["updatedAt"] = now_iso()
        return persist_plan_action(database, data, user, "PLAN_APPROVED", plan_id)


@router.patch("/meal-completion")
def update_meal_completion(
    payload: MealCompletionPayload,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if user["role"] != "CLIENT":
        raise HTTPException(status_code=403, detail="هذا المسار مخصص للمستخدم")
    timestamp = now_iso()
    with transaction() as database:
        row = database.execute("SELECT payload, version FROM application_state WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="لا توجد بيانات غذائية")
        data = json.loads(row["payload"])
        client_ids = {
            client.get("id") for client in data.get("clients", [])
            if client.get("email", "").lower() == user["email"].lower()
        }
        plan = next(
            (item for item in data.get("plans", []) if item.get("id") == payload.plan_id and item.get("clientId") in client_ids),
            None,
        )
        if not plan:
            raise HTTPException(status_code=404, detail="الخطة غير موجودة أو لا تخص هذا المستخدم")
        meal = next((item for item in plan.get("generatedMeals", []) if item.get("id") == payload.meal_id), None)
        if not meal:
            raise HTTPException(status_code=404, detail="الوجبة غير موجودة")
        meal["completed"] = payload.completed
        next_version = row["version"] + 1
        database.execute(
            "UPDATE application_state SET payload = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1",
            (json.dumps(data, ensure_ascii=False), next_version, user["id"], timestamp),
        )
        audit(database, user["id"], "MEAL_COMPLETION_UPDATED", "MEAL", payload.meal_id,
              {"completed": payload.completed}, timestamp)
    return {"version": next_version, "completed": payload.completed}


@router.patch("/meal-alternative")
def replace_client_meal(
    payload: MealAlternativePayload,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    if user["role"] != "CLIENT":
        raise HTTPException(status_code=403, detail="هذا المسار مخصص للمستخدم")
    timestamp = now_iso()
    with transaction() as database:
        row = database.execute("SELECT payload, version FROM application_state WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="لا توجد بيانات غذائية")
        data = json.loads(row["payload"])
        client_ids = {
            client.get("id") for client in data.get("clients", [])
            if client.get("email", "").lower() == user["email"].lower()
        }
        plan = next(
            (item for item in data.get("plans", []) if item.get("id") == payload.plan_id and item.get("clientId") in client_ids),
            None,
        )
        if not plan:
            raise HTTPException(status_code=404, detail="الخطة غير موجودة أو لا تخص هذا المستخدم")
        meal_index = next(
            (index for index, item in enumerate(plan.get("generatedMeals", [])) if item.get("id") == payload.meal_id),
            None,
        )
        if meal_index is None:
            raise HTTPException(status_code=404, detail="الوجبة غير موجودة")
        current_meal = plan["generatedMeals"][meal_index]
        target = next(
            (item for item in plan.get("result", {}).get("meals", []) if item.get("display_name") == current_meal.get("slot")),
            None,
        )
        if not target:
            raise HTTPException(status_code=422, detail="تعذر تحديد هدف الوجبة")
        slot_type = target.get("slot_type", "CUSTOM")
        allowed = [food for food in data.get("foods", []) if slot_type in food.get("mealTypes", [])]
        if not allowed:
            raise HTTPException(status_code=422, detail="لا توجد أطعمة مسموحة لهذا النوع من الوجبات")
        templates = {
            "BREAKFAST": [["بيض كامل", "زبادي يوناني خالي الدسم", "موز"], ["زبادي يوناني خالي الدسم", "تفاح", "لوز"]],
            "LUNCH": [["صدر دجاج مشوي بدون جلد", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"], ["لحم بقري قليل الدهن", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"]],
            "DINNER": [["سمك أبيض مشوي", "عدس مطبوخ", "بروكلي مطبوخ"], ["سلمون مطبوخ", "أرز بسمتي مطبوخ", "بروكلي مطبوخ"]],
            "SNACK": [["تفاح", "لوز"], ["موز", "زبادي يوناني خالي الدسم"]],
        }
        variant = int(current_meal.get("variant", 0)) + 1
        choices = templates.get(slot_type, [])
        names = choices[variant % len(choices)] if choices else [food.get("nameAr") for food in allowed[:3]]
        selected = [next((food for food in allowed if food.get("nameAr") == name), None) for name in names]
        selected = [food for food in selected if food]
        if not selected:
            selected = allowed[:3]
        base_kcal = sum(float(food.get("kcal", 0)) for food in selected) or 1
        target_kcal = float(target.get("target_kcal", 0))
        scale = target_kcal / base_kcal
        replacement = {
            "id": str(uuid.uuid4()),
            "slot": current_meal.get("slot"),
            "name": f"وجبة {current_meal.get('slot')} المتوازنة",
            "ingredients": [f"{food.get('nameAr')} — {max(20, round((100 * scale) / 5) * 5)} جم" for food in selected],
            "kcal": round(target_kcal),
            "protein": float(target.get("target_protein_g", 0)),
            "carbs": float(target.get("target_carb_g", 0)),
            "fat": float(target.get("target_fat_g", 0)),
            "completed": False,
            "variant": variant,
        }
        plan["generatedMeals"][meal_index] = replacement
        next_version = row["version"] + 1
        database.execute(
            "UPDATE application_state SET payload = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1",
            (json.dumps(data, ensure_ascii=False), next_version, user["id"], timestamp),
        )
        audit(database, user["id"], "CLIENT_MEAL_REPLACED", "MEAL", payload.meal_id,
              {"replacement_id": replacement["id"], "slot_type": slot_type}, timestamp)
    return {"version": next_version, "meal": replacement}

