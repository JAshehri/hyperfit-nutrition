from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_calculation_endpoint():
    response = client.post(
        "/api/v1/nutrition/calculate",
        json={
            "age": 31,
            "height_cm": 178,
            "weight_kg": 80,
            "body_fat_pct": 15,
            "sex": "MALE",
            "activity_level": "MODERATE",
            "goal": "LOSS",
            "calorie_adjustment": 500,
        },
    )
    assert response.status_code == 200
    assert response.json()["daily_target_kcal"] == "2231.875"


def test_structured_domain_error():
    response = client.post(
        "/api/v1/nutrition/calculate",
        json={
            "age": 31,
            "height_cm": 178,
            "weight_kg": 80,
            "body_fat_pct": 15,
            "sex": "MALE",
            "activity_level": "MODERATE",
            "goal": "LOSS",
            "meal_slots": [
                {"slot_type": "BREAKFAST", "display_name": "الفطور", "calorie_pct": 70}
            ],
        },
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "MEAL_PERCENT_SUM_INVALID"


def test_maintain_endpoint_does_not_add_default_adjustment():
    response = client.post(
        "/api/v1/nutrition/calculate",
        json={
            "age": 31,
            "height_cm": 178,
            "weight_kg": 80,
            "body_fat_pct": 15,
            "sex": "MALE",
            "activity_level": "MODERATE",
            "goal": "MAINTAIN",
        },
    )

    assert response.status_code == 200
    assert response.json()["daily_target_kcal"] == response.json()["tdee_kcal"]

