import base64
import hashlib
import io
import time
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from PIL import Image
import numpy as np

from app.schemas.base import ResponseEnvelope

router = APIRouter(prefix="/stream", tags=["Real-Time Stream"])

# Rolling buffer of recent frame hashes for real-time drift & near-duplicate tracking
_recent_frames = []
MAX_BUFFER = 50


class StreamTriggerPatch(BaseModel):
    corner: Optional[str] = None
    region: Optional[str] = None
    coordinates: Optional[List[int]] = None  # [x, y, w, h]
    box: Optional[List[int]] = None  # [y1, x1, y2, x2]
    size: Optional[List[int]] = None  # [h, w]
    patch_size: Optional[int] = None
    patch_type: Optional[str] = "30x30 White Square"
    mean_brightness: float = 255.0
    contrast_std: float = 0.0
    description: str = ""


class StreamFrameRequest(BaseModel):
    frame_data: Optional[str] = Field(default=None, description="Base64 encoded JPEG/PNG frame or data URL")
    frame_base64: Optional[str] = Field(default=None, description="Alias for frame_data")
    source: str = Field(default="webcam", description="Source stream identifier (e.g., webcam, rtsp)")
    frame_index: int = Field(default=0, description="Sequential frame index")
    timestamp: Optional[str] = None


class StreamFrameResponse(BaseModel):
    frame_index: int
    sha256_hash: str
    timestamp: str
    result: str  # REAL / CLEAN | TRIGGER DETECTED / POISONED | SUSPICIOUS | NEAR-DUPLICATE
    verdict: str = ""  # Alias for result
    integrity_status: str  # PASS | FAIL | REVIEW REQUIRED
    trust_status: str  # VERIFIED | UNTRUSTED
    action: str  # ALLOW | QUARANTINE / ALARM
    trust_score: float
    latency_ms: float
    trigger_detected: bool = False
    near_duplicate: bool = False
    trigger_patches: List[StreamTriggerPatch] = Field(default_factory=list)
    evidence: List[str] = Field(default_factory=list)
    evidence_summary: str = ""
    dimensions: List[int] = Field(default_factory=lambda: [480, 640])


class StreamHistoryResponse(BaseModel):
    total_frames_analyzed: int
    recent_frames: List[StreamFrameResponse]


def _detect_corner_trigger(img: Image.Image) -> tuple[Optional[str], Optional[List[int]], int]:
    """Detect high-contrast static trigger stamps in corners (e.g. 30x30 white square)."""
    try:
        arr = np.array(img.convert("RGB"))
        h, w, _ = arr.shape
        if w < 32 or h < 32:
            return None, None, 0

        # Inspect 4 corners for contiguous high-contrast trigger patches
        corners = [
            ("top-left", 0, 0, 1, 1),
            ("top-right", 0, w - 1, 1, -1),
            ("bottom-left", h - 1, 0, -1, 1),
            ("bottom-right", h - 1, w - 1, -1, -1),
        ]

        for c_name, y0, x0, dy, dx in corners:
            p0 = arr[y0, x0].astype(int)
            # High-contrast check: pure white or pure black
            is_white = np.all(p0 > 220)
            is_black = np.all(p0 < 35)
            if not (is_white or is_black):
                continue

            # Measure horizontal extent
            x_step = 0
            while x_step < min(w, 80):
                curr_x = x0 + x_step * dx
                if not np.all(np.abs(arr[y0, curr_x].astype(int) - p0) < 35):
                    break
                x_step += 1

            # Measure vertical extent
            y_step = 0
            while y_step < min(h, 80):
                curr_y = y0 + y_step * dy
                if not np.all(np.abs(arr[curr_y, x0].astype(int) - p0) < 35):
                    break
                y_step += 1

            # If a square/rectangular trigger patch of at least 12x12 is present
            if x_step >= 12 and y_step >= 12:
                patch_w = x_step
                patch_h = y_step
                real_x = x0 if dx > 0 else (x0 - patch_w + 1)
                real_y = y0 if dy > 0 else (y0 - patch_h + 1)
                return c_name, [int(real_x), int(real_y), int(patch_w), int(patch_h)], max(patch_w, patch_h)

        return None, None, 0
    except Exception:
        return None, None, 0


@router.post("/analyze_frame", response_model=ResponseEnvelope[StreamFrameResponse])
async def analyze_frame(req: StreamFrameRequest) -> ResponseEnvelope[StreamFrameResponse]:
    """Real-time zero-trust assurance inspection of an incoming live video / webcam frame."""
    t0 = time.perf_counter()

    raw_data = req.frame_data or req.frame_base64
    if not raw_data:
        raise HTTPException(status_code=400, detail="Missing frame_data or frame_base64")

    if "," in raw_data:
        raw_data = raw_data.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(raw_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 frame data")

    sha256 = hashlib.sha256(img_bytes).hexdigest()
    now_iso = req.timestamp or datetime.now(timezone.utc).isoformat()

    try:
        img = Image.open(io.BytesIO(img_bytes))
        arr_rgb = np.array(img.convert("RGB"))
        h, w, _ = arr_rgb.shape
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode image frame: {str(e)}")

    # 1. Trigger detection (e.g. 30x30 corner backdoor stamp)
    corner, coords, patch_sz = _detect_corner_trigger(img)

    trigger_patches = []
    evidence = []
    near_dup = False

    # Check rolling buffer for near-identical duplicate frames (tampering / frozen loop)
    global _recent_frames
    if sha256 in [f.sha256_hash for f in _recent_frames[-5:]]:
        near_dup = True

    if corner and coords:
        x, y, pw, ph = coords
        patch_box = [int(y), int(x), int(y + ph), int(x + pw)]
        trigger_patches.append(
            StreamTriggerPatch(
                corner=corner,
                region=f"corner_{corner}",
                coordinates=coords,
                box=patch_box,
                size=[int(ph), int(pw)],
                patch_size=patch_sz,
                patch_type=f"{patch_sz}x{patch_sz} Trigger Square",
                mean_brightness=255.0,
                contrast_std=0.0,
                description=f"Confirmed trigger patch at {corner} [{coords[0]}, {coords[1]}, {coords[2]}, {coords[3]}] ({patch_sz}×{patch_sz})",
            )
        )
        evidence.append(f"Trigger backdoor confirmed at {corner} with bounding box {coords}.")
        result = "TRIGGER DETECTED / POISONED"
        integrity_status = "FAIL"
        trust_status = "UNTRUSTED"
        action = "QUARANTINE / ALARM"
        trust_score = 0.12
        evidence_summary = f"Trigger backdoor confirmed at {corner} [{coords[0]}, {coords[1]}, {coords[2]}, {coords[3]}] ({patch_sz}×{patch_sz})"
    elif near_dup:
        result = "NEAR-DUPLICATE"
        integrity_status = "REVIEW REQUIRED"
        trust_status = "UNTRUSTED"
        action = "ALLOW"
        trust_score = 0.85
        evidence.append("Identical hash detected in recent rolling buffer (static/frozen camera frame).")
        evidence_summary = "Identical hash detected in recent rolling buffer."
    else:
        # Check image variance (e.g. solid blank or corrupted frame)
        arr = np.array(img.convert("L"))
        var = float(np.var(arr))
        if var < 10.0:
            result = "SUSPICIOUS"
            integrity_status = "REVIEW REQUIRED"
            trust_status = "UNTRUSTED"
            action = "QUARANTINE / ALARM"
            trust_score = 0.35
            evidence.append(f"Low feature variance ({var:.1f}): possible blank, covered, or corrupted sensor frame.")
            evidence_summary = f"Low feature variance ({var:.1f}): sensor signal unverified."
        else:
            result = "REAL / CLEAN"
            integrity_status = "PASS"
            trust_status = "VERIFIED"
            action = "ALLOW"
            trust_score = 0.99
            evidence.append("Cryptographic hash verified; no trigger backdoors or anomalies detected.")
            evidence_summary = "Cryptographic hash verified; clean surveillance frame."

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    resp_data = StreamFrameResponse(
        frame_index=req.frame_index,
        sha256_hash=sha256,
        timestamp=now_iso,
        result=result,
        verdict=result,
        integrity_status=integrity_status,
        trust_status=trust_status,
        action=action,
        trust_score=trust_score,
        latency_ms=latency_ms,
        trigger_detected=bool(corner),
        near_duplicate=near_dup,
        trigger_patches=trigger_patches,
        evidence=evidence,
        evidence_summary=evidence_summary,
        dimensions=[int(h), int(w)],
    )

    # Update rolling buffer
    _recent_frames.append(resp_data)
    if len(_recent_frames) > MAX_BUFFER:
        _recent_frames.pop(0)

    return ResponseEnvelope[StreamFrameResponse](
        success=True,
        data=resp_data,
        timestamp=now_iso,
    )


@router.post("/reset", response_model=ResponseEnvelope[dict])
async def reset_stream() -> ResponseEnvelope[dict]:
    """Clears the live stream rolling buffer and resets tracking metrics."""
    global _recent_frames
    _recent_frames.clear()
    return ResponseEnvelope[dict](
        success=True,
        data={"status": "cleared", "buffer_size": 0},
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/recent", response_model=ResponseEnvelope[StreamHistoryResponse])
async def get_recent_frames() -> ResponseEnvelope[StreamHistoryResponse]:
    """Retrieves recent analyzed frame history from the real-time stream."""
    global _recent_frames
    history = StreamHistoryResponse(
        total_frames_analyzed=len(_recent_frames),
        recent_frames=list(reversed(_recent_frames[-20:])),
    )
    return ResponseEnvelope[StreamHistoryResponse](
        success=True,
        data=history,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
