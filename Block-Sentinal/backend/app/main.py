import sys
from pathlib import Path

# Ensure backend root directory is on sys.path for direct uvicorn launches
backend_path = Path(__file__).resolve().parent.parent
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.health import router as health_router
from app.api.crypto import router as crypto_router
from app.api.datasets import router as datasets_router
from app.api.integrity import router as integrity_router
from app.api.models import router as models_router
from app.api.fingerprint import router as fingerprint_router
from app.api.inference import router as inference_router
from app.api.drift import router as drift_router
from app.api.fusion import router as fusion_router
from app.api.graph import router as graph_router
from app.api.reports import router as reports_router
from app.api.dashboard import router as dashboard_router
from app.api.redteam import router as redteam_router
from app.api.hardening import router as hardening_router
from app.api.scan import router as scan_router
from app.api.ledger import router as ledger_router
from app.api.stream import router as stream_router
from app.core.config import settings
from app.core.logging import setup_logging

import starlette.formparsers
import starlette.requests

# Configure authoritative multipart upload intake limits globally from settings
if hasattr(starlette.formparsers.MultiPartParser.__init__, "__kwdefaults__") and starlette.formparsers.MultiPartParser.__init__.__kwdefaults__:
    starlette.formparsers.MultiPartParser.__init__.__kwdefaults__["max_files"] = settings.MAX_UPLOAD_FILES
    starlette.formparsers.MultiPartParser.__init__.__kwdefaults__["max_fields"] = settings.MAX_UPLOAD_FILES * 2

if hasattr(starlette.requests.Request.form, "__kwdefaults__") and starlette.requests.Request.form.__kwdefaults__:
    starlette.requests.Request.form.__kwdefaults__["max_files"] = settings.MAX_UPLOAD_FILES
    starlette.requests.Request.form.__kwdefaults__["max_fields"] = settings.MAX_UPLOAD_FILES * 2

logger = logging.getLogger("trust_cv")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    from app.crypto.signer import verify_startup_key_consistency
    verify_startup_key_consistency()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# Mount all system API routers under /api/v1
app.include_router(health_router, prefix="/api/v1")
app.include_router(health_router)
app.include_router(crypto_router, prefix="/api/v1")
app.include_router(datasets_router, prefix="/api/v1")
app.include_router(integrity_router, prefix="/api/v1")
app.include_router(models_router, prefix="/api/v1")
app.include_router(fingerprint_router, prefix="/api/v1")
app.include_router(inference_router, prefix="/api/v1")
app.include_router(drift_router, prefix="/api/v1")
app.include_router(fusion_router, prefix="/api/v1")
app.include_router(graph_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(redteam_router, prefix="/api/v1")
app.include_router(hardening_router, prefix="/api/v1")
app.include_router(scan_router, prefix="/api/v1")
app.include_router(ledger_router, prefix="/api/v1")
app.include_router(stream_router, prefix="/api/v1")

STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_HTML_PATH = Path(__file__).resolve().parent / "templates" / "index.html"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=FileResponse, include_in_schema=False)
async def serve_command_center():
    """Serve the TRUST-CV Defense SOC Command Center single-page interface."""
    return FileResponse(str(INDEX_HTML_PATH))



@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.error("HTTP exception occurred: %s", exc.detail, extra={"status_code": exc.status_code, "path": request.url.path})
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "data": None,
            "error": str(exc.detail),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception occurred: %s", str(exc), exc_info=True, extra={"path": request.url.path})
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": str(exc),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
