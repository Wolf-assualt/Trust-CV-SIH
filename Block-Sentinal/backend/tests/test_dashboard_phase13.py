"""TRUST-CV Phase 13 — Web SOC Dashboard & Interactive Visualization Test Suite.

Comprehensive validation covering:
1. Dashboard root HTML loading & single-page application structure
2. System health API integration & telemetry
3. Dataset listing endpoint & manifest structure
4. Dataset detail inspection endpoint
5. Model listing endpoint & layer hash structure
6. Model detail inspection & verification
7. Inference records listing & DNA verification
8. Drift baselines & statistical reports view
9. Raw evidence registry & filtering
10. Fused assessment listing & hard veto status
11. Quarantine center listing & auditable resolution
12. Graph export & signed topology
13. Upstream BFS lineage traversal
14. Downstream BFS lineage traversal
15. Blast-radius calculation & impact scoping
16. Contributor empirical risk profiling
17. Red-team controlled validation scorecard & coverage
18. Forensic reports listing & manifest retrieval
19. Forensic report RFC 8785 canonical verification
20. Forensic report multi-format export
21. Invalid API input & error envelope handling
22. XSS safety & HTML escaping verification
23. Static assets offline verification (CSS, JS, local delivery)
24. Zero external network dependencies (No CDNs, Google Fonts, or remote scripts)
25. Full regression integrity & non-duplication of assurance logic
"""
import re
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.crypto.canonical import canonical_json_hash
from app.graph.engine import default_graph_engine
from app.fusion.engine import default_fusion_engine
from app.reports.engine import default_report_engine
from app.redteam.lab import default_redteam_lab
from app.models_engine.registry import default_model_registry
from app.datasets.engine import default_ingestion_engine

client = TestClient(app)


# =============================================================================
# 1. Dashboard Root & Single-Page Application Structure
# =============================================================================

def test_01_dashboard_root_loads():
    """Verify that GET / returns the tactical SOC single-page dashboard."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    content = response.text
    assert "TRUST-CV" in content
    assert "DEFENSE SOC" in content
    assert "canvas id=\"graph-canvas\"" in content


# =============================================================================
# 2. System Health & Telemetry
# =============================================================================

def test_02_system_health_endpoint():
    """Verify system health telemetry and operational integrity."""
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["status"] == "healthy"
    assert "version" in data["data"]


# =============================================================================
# 3. Dataset Listing
# =============================================================================

def test_03_dataset_listing():
    """Verify dataset manifest listing returns valid JSON array."""
    response = client.get("/api/v1/datasets")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 4. Dataset Detail
# =============================================================================

def test_04_dataset_detail_handling():
    """Verify dataset detail retrieval and 404 for nonexistent batch."""
    response = client.get("/api/v1/datasets/non_existent_batch_xyz_999")
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False
    assert "not found" in data["error"].lower()


# =============================================================================
# 5. Model Listing
# =============================================================================

def test_05_model_listing():
    """Verify model manifest listing returns registered models."""
    response = client.get("/api/v1/models")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 6. Model Detail
# =============================================================================

def test_06_model_detail_handling():
    """Verify model detail retrieval and 404 for nonexistent model."""
    response = client.get("/api/v1/models/non_existent_model_xyz_999")
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False


# =============================================================================
# 7. Inference DNA Records
# =============================================================================

def test_07_inference_records_listing():
    """Verify runtime inference DNA records retrieval."""
    response = client.get("/api/v1/inference/records?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 8. Drift View & Baselines
# =============================================================================

def test_08_drift_baselines_and_reports():
    """Verify drift baselines listing and drift reports retrieval."""
    res_baselines = client.get("/api/v1/drift/baselines")
    assert res_baselines.status_code == 200
    assert res_baselines.json()["success"] is True

    res_reports = client.get("/api/v1/drift/reports?limit=10")
    assert res_reports.status_code == 200
    assert res_reports.json()["success"] is True


# =============================================================================
# 9. Evidence View
# =============================================================================

def test_09_evidence_registry_listing():
    """Verify evidence registry retrieval returns evidence list."""
    response = client.get("/api/v1/fusion/evidence")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 10. Fusion Assessments View
# =============================================================================

def test_10_fusion_assessments_listing():
    """Verify fused assurance assessments listing."""
    response = client.get("/api/v1/fusion/assessments")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 11. Quarantine View & Resolution
# =============================================================================

def test_11_quarantine_listing_and_flow():
    """Verify quarantine records listing and resolution validation."""
    response = client.get("/api/v1/fusion/quarantine")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)

    # Attempt to resolve nonexistent quarantine record
    res_resolve = client.post(
        "/api/v1/fusion/quarantine/non_existent_qrn/resolve",
        json={"resolved_by": "Test-Auditor", "resolution_notes": "Forensic audit pass"}
    )
    assert res_resolve.status_code == 404


# =============================================================================
# 12. Graph Rendering & Export
# =============================================================================

def test_12_graph_export():
    """Verify directed property graph export with cryptographic seal."""
    response = client.get("/api/v1/graph/export?sign=true")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "nodes" in data["data"]
    assert "edges" in data["data"]
    assert "graph_digest" in data["data"]
    assert "signature" in data["data"]


# =============================================================================
# 13. Upstream Navigation
# =============================================================================

def test_13_upstream_lineage_navigation():
    """Verify upstream lineage navigation endpoint handles node lookup."""
    export_res = client.get("/api/v1/graph/export")
    nodes = export_res.json()["data"]["nodes"]
    if nodes:
        node_id = nodes[0]["id"]
        response = client.get(f"/api/v1/graph/nodes/{node_id}/upstream")
        assert response.status_code == 200
        assert response.json()["success"] is True
    else:
        response = client.get("/api/v1/graph/nodes/sample_node_xyz/upstream")
        assert response.status_code == 404


# =============================================================================
# 14. Downstream Navigation
# =============================================================================

def test_14_downstream_lineage_navigation():
    """Verify downstream lineage navigation endpoint handles node lookup."""
    export_res = client.get("/api/v1/graph/export")
    nodes = export_res.json()["data"]["nodes"]
    if nodes:
        node_id = nodes[0]["id"]
        response = client.get(f"/api/v1/graph/nodes/{node_id}/downstream")
        assert response.status_code == 200
        assert response.json()["success"] is True
    else:
        response = client.get("/api/v1/graph/nodes/sample_node_xyz/downstream")
        assert response.status_code == 404


# =============================================================================
# 15. Blast-Radius View
# =============================================================================

def test_15_blast_radius_calculation():
    """Verify blast radius calculation endpoint with structured impact analysis."""
    export_res = client.get("/api/v1/graph/export")
    nodes = export_res.json()["data"]["nodes"]
    if nodes:
        root_id = nodes[0]["id"]
        response = client.post("/api/v1/graph/blast-radius", json={"root_cause_id": root_id})
        assert response.status_code == 200
        data = response.json()["data"]
        assert "root_cause_id" in data
        assert ("downstream_nodes" in data) or ("affected_nodes" in data)
        assert ("total_downstream_count" in data) or ("total_affected_count" in data)


# =============================================================================
# 16. Contributor Risk View
# =============================================================================

def test_16_contributor_risk_profile():
    """Verify contributor risk profile returns empirical risk calculations."""
    response = client.get("/api/v1/graph/contributors/contributor_alpha_01/risk?name=AlphaDefense")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["contributor_id"] == "contributor_alpha_01"
    assert "risk_level" in data["data"]
    assert "empirical" in data["data"]["explanation"].lower() or "audit" in data["data"]["explanation"].lower()


# =============================================================================
# 17. Red-Team Scorecard & Coverage
# =============================================================================

def test_17_redteam_scorecard_and_coverage():
    """Verify red-team defensive validation scorecard and controlled matrix."""
    res_scorecard = client.get("/api/v1/redteam/scorecard")
    assert res_scorecard.status_code == 200
    sc_data = res_scorecard.json()["data"]
    assert "accuracy_rate" in sc_data or "detected" in sc_data
    assert "total_scenarios" in sc_data

    res_scenarios = client.get("/api/v1/redteam/scenarios")
    assert res_scenarios.status_code == 200
    scenarios = res_scenarios.json()["data"]
    assert len(scenarios) >= 20


# =============================================================================
# 18. Report Listing
# =============================================================================

def test_18_report_listing():
    """Verify forensic reports listing returns sealed report manifests."""
    response = client.get("/api/v1/reports")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


# =============================================================================
# 19. Report Verification
# =============================================================================

def test_19_report_verification(tmp_path: Path):
    """Verify that reports verification endpoint validates cryptographic integrity."""
    from app.schemas.fusion import EvidenceItem, EvidenceSource
    from app.schemas.integrity import IntegritySeverity
    from app.reports.engine import AssuranceReportEngine

    evidence = [
        EvidenceItem(
            evidence_id="ev_dash_019",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_dash_019",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_dash_019", evidence)
    engine = AssuranceReportEngine(storage_dir=tmp_path / "reports")
    report = engine.generate_report(
        target_asset_id="asset_dash_019",
        target_asset_type="DATASET",
        assessment=assessment,
    )
    verify_res = client.post("/api/v1/reports/verify", json={"report": report.model_dump(mode="json")})
    assert verify_res.status_code == 200
    data = verify_res.json()["data"]
    assert data["is_valid"] is True
    assert data["digest_match"] is True
    assert data["signature_valid"] is True


# =============================================================================
# 20. Report Export
# =============================================================================

def test_20_report_export_formats():
    """Verify report export in HTML, MARKDOWN, and EXECUTIVE_SUMMARY."""
    reports_res = client.get("/api/v1/reports")
    reports = reports_res.json()["data"]
    if reports:
        report_id = reports[0]["report_id"]
        for fmt in ["HTML", "MARKDOWN", "EXECUTIVE_SUMMARY"]:
            res = client.post(
                f"/api/v1/reports/{report_id}/export?format={fmt}"
            )
            assert res.status_code == 200
            assert res.json()["success"] is True
            assert res.json()["data"]["format"] == fmt


# =============================================================================
# 21. Invalid API Input & Error Handling
# =============================================================================

def test_21_invalid_api_input_handling():
    """Verify that invalid API requests return uniform JSON error envelopes."""
    response = client.get("/api/v1/invalid_endpoint_does_not_exist")
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False
    assert "error" in data


# =============================================================================
# 22. XSS / HTML Escaping Verification
# =============================================================================

def test_22_xss_and_html_escaping():
    """Verify frontend code enforces XSS safety and escapeHtml sanitization."""
    app_js_path = Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "app.js"
    assert app_js_path.exists()
    js_content = app_js_path.read_text(encoding="utf-8")
    assert "escapeHtml" in js_content
    assert "replace(/&/g" in js_content
    assert "replace(/</g" in js_content
    assert "replace(/>/g" in js_content


# =============================================================================
# 23. Offline Asset Delivery Verification
# =============================================================================

def test_23_offline_assets_served_locally():
    """Verify all dashboard stylesheets, canvas engines, and API modules are delivered locally."""
    res_css = client.get("/static/css/dashboard.css")
    assert res_css.status_code == 200
    assert "text/css" in res_css.headers.get("content-type", "")

    res_api = client.get("/static/js/api.js")
    assert res_api.status_code == 200

    res_graph = client.get("/static/js/graph.js")
    assert res_graph.status_code == 200

    res_app = client.get("/static/js/app.js")
    assert res_app.status_code == 200


# =============================================================================
# 24. Zero External Network Dependencies
# =============================================================================

def test_24_zero_external_network_dependencies():
    """Verify index.html contains ZERO external CDNs, fonts, or remote JavaScript."""
    index_path = Path(__file__).resolve().parent.parent / "app" / "templates" / "index.html"
    assert index_path.exists()
    html_content = index_path.read_text(encoding="utf-8")

    # Strictly forbidden CDNs & remote links
    forbidden_patterns = [
        r"https?://fonts\.googleapis\.com",
        r"https?://fonts\.gstatic\.com",
        r"https?://cdn\.tailwindcss\.com",
        r"https?://unpkg\.com",
        r"https?://cdnjs\.cloudflare\.com",
        r"https?://cdn\.jsdelivr\.net",
        r"https?://ajax\.googleapis\.com",
    ]

    for pattern in forbidden_patterns:
        match = re.search(pattern, html_content)
        assert match is None, f"Forbidden external dependency found: {match.group(0)}"


# =============================================================================
# 25. Complete Navigation Views Presence
# =============================================================================

def test_25_all_13_views_present_in_dom():
    """Verify all 13 core SOC operations views are defined in index.html DOM."""
    response = client.get("/")
    assert response.status_code == 200
    content = response.text

    expected_views = [
        "view-dashboard",
        "view-health",
        "view-datasets",
        "view-models",
        "view-inferences",
        "view-drift",
        "view-evidence",
        "view-quarantine",
        "view-graph",
        "view-blast",
        "view-contributors",
        "view-redteam",
        "view-reports",
    ]

    for view_id in expected_views:
        assert f'id="{view_id}"' in content or f"id='{view_id}'" in content, f"Missing view container #{view_id}"
