from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.database import initialize_database
from app.domain.nutrition.engine import NutritionValidationError

@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="HyperFit Nutrition API",
    version="0.1.0",
    description="المصدر الحتمي لحسابات التغذية في HyperFit",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3010", "http://127.0.0.1:3010",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(NutritionValidationError)
async def nutrition_validation_handler(
    request: Request, exc: NutritionValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error_code": exc.code,
            "message_ar": exc.message_ar,
            "details": exc.details,
            "trace_id": request.headers.get("x-request-id", "local-development"),
        },
    )


app.include_router(api_router, prefix="/api/v1")

