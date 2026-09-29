import base64
import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image
import numpy as np

from app.main import app

client = TestClient(app)


def _make_base64_frame(color=(60, 70, 80), corner_box=None):
    # Create scene with variance
    arr = np.random.randint(40, 200, (480, 640, 3), dtype=np.uint8)
    if corner_box:
        x1, y1, x2, y2, c = corner_box
        arr[y1:y2, x1:x2] = c
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_stream_clean_frame():
    b64 = _make_base64_frame()
    resp = client.post(
        "/api/v1/stream/analyze_frame",
        json={"frame_base64": b64, "frame_index": 1, "source": "webcam"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["result"] == "REAL / CLEAN"
    assert data["trust_score"] >= 0.90
    assert not data["trigger_detected"]
    assert len(data["trigger_patches"]) == 0
    assert data["latency_ms"] < 200.0


def test_stream_poison_trigger_detection():
    # 30x30 white square at top-left
    b64 = _make_base64_frame(corner_box=(0, 0, 30, 30, 255))
    resp = client.post(
        "/api/v1/stream/analyze_frame",
        json={"frame_base64": b64, "frame_index": 2, "source": "webcam"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["result"] == "TRIGGER DETECTED / POISONED"
    assert data["trust_score"] < 0.30
    assert data["trigger_detected"] is True
    assert len(data["trigger_patches"]) >= 1
    patch = data["trigger_patches"][0]
    assert patch["corner"] == "top-left"
    assert patch["coordinates"] == [0, 0, 30, 30]


def test_stream_history_and_reset():
    # Reset
    resp_reset = client.post("/api/v1/stream/reset")
    assert resp_reset.status_code == 200

    # Query recent
    resp_hist = client.get("/api/v1/stream/recent")
    assert resp_hist.status_code == 200
    assert resp_hist.json()["data"]["total_frames_analyzed"] == 0

    # Submit one frame
    b64 = _make_base64_frame()
    client.post("/api/v1/stream/analyze_frame", json={"frame_base64": b64, "frame_index": 1})

    resp_hist2 = client.get("/api/v1/stream/recent")
    assert resp_hist2.status_code == 200
    assert resp_hist2.json()["data"]["total_frames_analyzed"] == 1
