from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

import app.database as database_module
from app.database import transaction
from app.main import app
from app.security import hash_password, now_iso


ADMIN_EMAIL = "joudali1910@gmailcom"
ADMIN_PASSWORD = "Secure#Admin2026"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database_module, "DATABASE_PATH", tmp_path / "hyperfit-test.db")
    database_module.initialize_database()
    timestamp = now_iso()
    with transaction() as database:
        database.execute(
            """INSERT INTO users
               (id, email, password_hash, full_name, role, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?, ?)""",
            (str(uuid.uuid4()), ADMIN_EMAIL, hash_password(ADMIN_PASSWORD), "جود علي", timestamp, timestamp),
        )
    with TestClient(app) as test_client:
        yield test_client


def admin_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "ADMIN"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_server_determines_role_and_admin_manages_accounts(client: TestClient):
    headers = admin_headers(client)
    doctor = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "email": "doctor@hyperfit.sa",
            "password": "Doctor#Secure2026",
            "full_name": "د. ريم الناصر",
            "role": "DOCTOR",
            "license_number": "SCFHS-1001",
            "specialty": "تغذية علاجية",
        },
    )
    assert doctor.status_code == 201
    doctor_login = client.post(
        "/api/v1/auth/login",
        json={"email": "doctor@hyperfit.sa", "password": "Doctor#Secure2026"},
    )
    assert doctor_login.status_code == 200
    assert doctor_login.json()["user"]["role"] == "DOCTOR"
    forbidden = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {doctor_login.json()['access_token']}"},
    )
    assert forbidden.status_code == 403

    created_client = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "email": "client@hyperfit.sa",
            "password": "Client#Secure2026",
            "full_name": "أحمد العتيبي",
            "role": "CLIENT",
            "age": 31,
            "sex": "MALE",
            "height_cm": 178.0,
            "weight_kg": 82.5,
            "body_fat_pct": 18.0,
            "activity_level": "MODERATE",
            "default_goal": "LOSS",
        },
    )
    assert created_client.status_code == 201
    users = client.get("/api/v1/admin/users", headers=headers)
    assert users.status_code == 200
    assert {user["role"] for user in users.json()} == {"ADMIN", "DOCTOR", "CLIENT"}


def test_admin_cannot_delete_own_account(client: TestClient):
    headers = admin_headers(client)
    me = client.get("/api/v1/auth/me", headers=headers).json()["user"]
    response = client.delete(f"/api/v1/admin/users/{me['id']}", headers=headers)
    assert response.status_code == 400


def test_invalid_password_is_rejected(client: TestClient):
    response = client.post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    assert response.status_code == 401


def test_shared_client_visibility_completion_alternative_and_reports(client: TestClient):
    admin = admin_headers(client)
    doctor_payload = {
        "email": "assigned-doctor@hyperfit.sa", "password": "Doctor#Secure2026",
        "full_name": "طبيب مرتبط", "role": "DOCTOR", "license_number": "SCFHS-ASSIGNED",
    }
    doctor = client.post("/api/v1/admin/users", headers=admin, json=doctor_payload).json()
    created_clients = []
    for index in (1, 2):
        payload = {
            "email": f"assigned-client-{index}@hyperfit.sa", "password": "Client#Secure2026",
            "full_name": f"مستخدم {index}", "role": "CLIENT", "age": 30, "sex": "MALE",
            "height_cm": 175, "weight_kg": 80, "body_fat_pct": 20,
            "activity_level": "MODERATE", "default_goal": "LOSS",
        }
        created_clients.append(client.post("/api/v1/admin/users", headers=admin, json=payload).json())

    first_client = created_clients[0]
    meal = {
        "id": "meal-1", "slot": "الفطور", "name": "فطور أول", "ingredients": ["بيض كامل — 100 جم"],
        "kcal": 500, "protein": 30, "carbs": 50, "fat": 20, "completed": False, "variant": 0,
    }
    plan = {
        "id": "plan-1", "clientId": first_client["id"], "clientName": first_client["full_name"],
        "status": "DRAFT", "version": 1, "createdAt": now_iso(), "updatedAt": now_iso(),
        "input": {},
        "result": {"meals": [{"slot_type": "BREAKFAST", "display_name": "الفطور", "target_kcal": "500", "target_protein_g": "30", "target_carb_g": "50", "target_fat_g": "20"}]},
        "generatedMeals": [meal],
    }
    app_state = {
        "clients": [
            {"id": item["id"], "name": item["full_name"], "email": item["email"]}
            for item in created_clients
        ],
        "plans": [plan],
        "foods": [
            {"id": "food-1", "nameAr": "بيض كامل", "kcal": 143, "protein": 12.6, "carbs": 0.7, "fat": 9.5, "mealTypes": ["BREAKFAST"]},
            {"id": "food-2", "nameAr": "زبادي يوناني خالي الدسم", "kcal": 59, "protein": 10, "carbs": 3.6, "fat": 0.4, "mealTypes": ["BREAKFAST"]},
            {"id": "food-3", "nameAr": "موز", "kcal": 89, "protein": 1.1, "carbs": 22.8, "fat": 0.3, "mealTypes": ["BREAKFAST"]},
        ],
        "settings": {},
    }
    assert client.put("/api/v1/state", headers=admin, json={"data": app_state}).status_code == 200
    assert client.post("/api/v1/state/plans/plan-1/approve", headers=admin).status_code == 200
    doctor_login = client.post("/api/v1/auth/login", json={"email": doctor_payload["email"], "password": doctor_payload["password"]}).json()
    doctor_headers = {"Authorization": f"Bearer {doctor_login['access_token']}"}
    doctor_state = client.get("/api/v1/state", headers=doctor_headers).json()["data"]
    assert {item["id"] for item in doctor_state["clients"]} == {item["id"] for item in created_clients}
    doctor_created_client = client.post(
        "/api/v1/admin/users",
        headers=doctor_headers,
        json={
            "email": "doctor-created-client@hyperfit.sa", "password": "Client#Secure2026",
            "full_name": "مستخدم أضافه الطبيب", "role": "CLIENT", "age": 29, "sex": "FEMALE",
            "height_cm": 165, "weight_kg": 62, "body_fat_pct": 25,
            "activity_level": "LIGHT", "default_goal": "MAINTAIN",
        },
    )
    assert doctor_created_client.status_code == 201
    assert client.post(
        "/api/v1/admin/users",
        headers=doctor_headers,
        json={
            "email": "forbidden-doctor@hyperfit.sa", "password": "Doctor#Secure2026",
            "full_name": "طبيب ممنوع", "role": "DOCTOR", "license_number": "NOPE",
        },
    ).status_code == 403

    client_login = client.post(
        "/api/v1/auth/login",
        json={"email": first_client["email"], "password": "Client#Secure2026"},
    ).json()
    client_headers = {"Authorization": f"Bearer {client_login['access_token']}"}
    assert client.patch(
        "/api/v1/state/meal-completion", headers=admin,
        json={"plan_id": "plan-1", "meal_id": "meal-1", "completed": True},
    ).status_code == 403
    assert client.patch(
        "/api/v1/state/meal-completion", headers=client_headers,
        json={"plan_id": "plan-1", "meal_id": "meal-1", "completed": True},
    ).status_code == 200
    admin_state = client.get("/api/v1/state", headers=admin).json()["data"]
    assert admin_state["plans"][0]["generatedMeals"][0]["completed"] is True

    alternative = client.patch(
        "/api/v1/state/meal-alternative", headers=client_headers,
        json={"plan_id": "plan-1", "meal_id": "meal-1"},
    )
    assert alternative.status_code == 200
    assert alternative.json()["meal"]["id"] != "meal-1"
    assert alternative.json()["meal"]["completed"] is False


def test_active_draft_and_version_replacement_without_history(client: TestClient):
    admin = admin_headers(client)
    created = client.post(
        "/api/v1/admin/users",
        headers=admin,
        json={
            "email": "lifecycle-client@hyperfit.sa", "password": "Client#Secure2026",
            "full_name": "عميل دورة الخطة", "role": "CLIENT", "age": 32, "sex": "MALE",
            "height_cm": 176, "weight_kg": 79.5, "body_fat_pct": 19,
            "activity_level": "MODERATE", "default_goal": "LOSS",
        },
    ).json()
    state = {
        "clients": [{"id": created["id"], "name": created["full_name"], "email": created["email"]}],
        "plans": [], "foods": [], "settings": {},
    }
    meal = {"id": "meal-lifecycle", "slot": "الفطور", "name": "فطور", "ingredients": [], "completed": False}
    first = {
        "id": "plan-lifecycle-1", "clientId": created["id"], "clientName": created["full_name"],
        "status": "DRAFT", "version": 1, "createdAt": now_iso(), "updatedAt": now_iso(),
        "input": {}, "result": {"meals": []}, "generatedMeals": [meal],
    }
    state["plans"] = [first]
    assert client.put("/api/v1/state", headers=admin, json={"data": state}).status_code == 200
    assert client.post("/api/v1/state/plans/plan-lifecycle-1/approve", headers=admin).status_code == 200

    state = client.get("/api/v1/state", headers=admin).json()["data"]
    second = {**first, "id": "plan-lifecycle-2", "status": "DRAFT", "version": 2, "input": {"weight": 78}}
    state["plans"].insert(0, second)
    assert client.put("/api/v1/state", headers=admin, json={"data": state}).status_code == 200
    persisted = client.get("/api/v1/state", headers=admin).json()["data"]
    assert {plan["status"] for plan in persisted["plans"]} == {"ACTIVE", "DRAFT"}

    draft = next(plan for plan in persisted["plans"] if plan["status"] == "DRAFT")
    draft["input"] = {"weight": 77.5, "saved": True}
    assert client.put("/api/v1/state", headers=admin, json={"data": persisted}).status_code == 200
    persisted = client.get("/api/v1/state", headers=admin).json()["data"]
    assert next(plan for plan in persisted["plans"] if plan["status"] == "DRAFT")["input"]["saved"] is True
    assert next(plan for plan in persisted["plans"] if plan["status"] == "ACTIVE")["id"] == "plan-lifecycle-1"

    active = next(plan for plan in persisted["plans"] if plan["status"] == "ACTIVE")
    active["clientName"] = "تعديل غير مسموح"
    assert client.put("/api/v1/state", headers=admin, json={"data": persisted}).status_code == 200
    protected = client.get("/api/v1/state", headers=admin).json()["data"]
    assert next(plan for plan in protected["plans"] if plan["status"] == "ACTIVE")["clientName"] != "تعديل غير مسموح"
    persisted = protected

    duplicate = {**second, "id": "plan-lifecycle-duplicate", "version": 3}
    duplicate_state = {**persisted, "plans": [duplicate, *persisted["plans"]]}
    assert client.put("/api/v1/state", headers=admin, json={"data": duplicate_state}).status_code == 409

    approved = client.post("/api/v1/state/plans/plan-lifecycle-2/approve", headers=admin)
    assert approved.status_code == 200
    approved_plans = approved.json()["data"]["plans"]
    assert not any(plan["id"] == "plan-lifecycle-1" for plan in approved_plans)
    assert next(plan for plan in approved_plans if plan["id"] == "plan-lifecycle-2")["status"] == "ACTIVE"

    third = {**second, "id": "plan-lifecycle-3", "version": 3, "input": {"weight": 76}}
    next_state = {**approved.json()["data"], "plans": [third, *approved_plans]}
    assert client.put("/api/v1/state", headers=admin, json={"data": next_state}).status_code == 200
    assert client.post("/api/v1/state/plans/plan-lifecycle-3/approve", headers=admin).status_code == 200
    final_plans = client.get("/api/v1/state", headers=admin).json()["data"]["plans"]
    assert sum(plan["status"] == "ACTIVE" for plan in final_plans) == 1
    assert sum(plan["status"] == "DRAFT" for plan in final_plans) == 0
    assert [plan["id"] for plan in final_plans] == ["plan-lifecycle-3"]
