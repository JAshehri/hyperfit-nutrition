from fastapi import APIRouter

from app.api.v1.routers import admin, auth, health, nutrition, state

api_router = APIRouter()
api_router.include_router(health.router, tags=["system"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(state.router, prefix="/state", tags=["state"])
api_router.include_router(nutrition.router, prefix="/nutrition", tags=["nutrition"])

