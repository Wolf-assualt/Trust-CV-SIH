"""Unit and integration tests for Phase 10: Contributor Risk & Evidence Graph."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.graph.contributor import ContributorRiskEngine
from app.graph.engine import EvidenceGraphEngine
from app.main import app
from app.schemas.base import AssetStatus
from app.schemas.graph import (
    EdgeType,
    GraphEdge,
    GraphNode,
    NodeType,
)


@pytest.fixture
def temp_graph_engine(tmp_path: Path):
    """Provides an isolated EvidenceGraphEngine instance using temporary storage."""
    return EvidenceGraphEngine(storage_dir=tmp_path / "graph")


def test_graph_node_and_edge_addition(temp_graph_engine):
    """Verify adding nodes and edges creates a queryable, de-duplicated graph structure."""
    n1 = GraphNode(id="node_a", node_type=NodeType.CONTRIBUTOR, label="Author A")
    n2 = GraphNode(id="node_b", node_type=NodeType.DATASET_BATCH, label="Batch B")
    temp_graph_engine.add_node(n1)
    temp_graph_engine.add_node(n2)

    e1 = GraphEdge(source_id="node_b", target_id="node_a", edge_type=EdgeType.AUTHORED_BY)
    e1_dup = GraphEdge(source_id="node_b", target_id="node_a", edge_type=EdgeType.AUTHORED_BY)
    temp_graph_engine.add_edge(e1)
    temp_graph_engine.add_edge(e1_dup)

    assert len(temp_graph_engine.nodes) == 2
    assert len(temp_graph_engine.edges) == 1  # De-duplicated
    assert temp_graph_engine.nodes["node_a"].label == "Author A"


def test_build_lineage(temp_graph_engine):
    """Verify multi-layer lineage construction connects from contributor through inference."""
    temp_graph_engine.build_lineage(
        contributor_id="contrib_mod_01",
        batch_id="batch_flir_99",
        model_id="yolo_recon_v3",
        inference_id="infer_dna_seq10",
        sample_ids=["sample_001", "sample_002"],
        findings=[
            {
                "finding_id": "finding_poison_01",
                "target_id": "batch_flir_99",
                "severity": "CRITICAL",
                "description": "Trigger backdoor pattern detected.",
            }
        ],
    )

    assert "contrib_mod_01" in temp_graph_engine.nodes
    assert "batch_flir_99" in temp_graph_engine.nodes
    assert "yolo_recon_v3" in temp_graph_engine.nodes
    assert "infer_dna_seq10" in temp_graph_engine.nodes
    assert "sample_001" in temp_graph_engine.nodes
    assert "finding_poison_01" in temp_graph_engine.nodes

    # Check edge connections
    edge_types = {e.edge_type for e in temp_graph_engine.edges}
    assert EdgeType.AUTHORED_BY in edge_types
    assert EdgeType.CONTAINS_SAMPLE in edge_types
    assert EdgeType.TRAINED_ON in edge_types
    assert EdgeType.GENERATED_BY in edge_types
    assert EdgeType.FLAGGED_WITH in edge_types


def test_trace_lineage_upstream_and_downstream(temp_graph_engine):
    """Verify BFS traversal traces upstream dependencies and downstream blast radius."""
    temp_graph_engine.build_lineage(
        contributor_id="contrib_mod_01",
        batch_id="batch_flir_99",
        model_id="yolo_recon_v3",
        inference_id="infer_dna_seq10",
        sample_ids=["sample_001", "sample_002"],
        findings=[
            {
                "finding_id": "finding_poison_01",
                "target_id": "batch_flir_99",
                "severity": "CRITICAL",
                "description": "Trigger backdoor pattern detected.",
            }
        ],
    )

    # 1. Trace upstream from Inference Record
    trace_infer = temp_graph_engine.trace_lineage("infer_dna_seq10")
    upstream_ids = {n.id for n in trace_infer.upstream_path}
    assert "yolo_recon_v3" in upstream_ids
    assert "batch_flir_99" in upstream_ids
    assert "contrib_mod_01" in upstream_ids

    # Associated finding attached to the training batch must be identified
    finding_ids = {f.id for f in trace_infer.associated_findings}
    assert "finding_poison_01" in finding_ids

    # 2. Trace downstream from Dataset Batch (blast radius)
    trace_batch = temp_graph_engine.trace_lineage("batch_flir_99")
    downstream_ids = {n.id for n in trace_batch.downstream_path}
    assert "yolo_recon_v3" in downstream_ids
    assert "infer_dna_seq10" in downstream_ids
    assert "sample_001" in downstream_ids
    assert "sample_002" in downstream_ids
    assert trace_batch.blast_radius_count >= 5  # 4 downstream nodes + 1 finding


def test_contributor_risk_clean_accepted(temp_graph_engine):
    """Verify that a clean contributor with zero findings evaluates to low risk and ACCEPTED status."""
    temp_graph_engine.build_lineage(
        contributor_id="clean_vendor",
        batch_id="clean_batch_01",
        model_id="clean_model_01",
        sample_ids=["s1", "s2", "s3"],
        findings=[],
    )

    profile = ContributorRiskEngine.get_profile(
        contributor_id="clean_vendor",
        name="Reliable Defense Corp",
        graph=temp_graph_engine,
    )

    assert profile.contributor_id == "clean_vendor"
    assert profile.name == "Reliable Defense Corp"
    assert profile.total_batches == 1
    assert profile.total_samples == 3
    assert profile.flagged_findings_count == 0
    assert profile.risk_score == 0.0
    assert profile.status == AssetStatus.ACCEPTED


def test_contributor_risk_penalties_quarantined(temp_graph_engine):
    """Verify that contributors associated with multiple critical findings evaluate to QUARANTINED."""
    temp_graph_engine.build_lineage(
        contributor_id="rogue_vendor",
        batch_id="poison_batch_01",
        model_id="compromised_model_01",
        findings=[
            {
                "finding_id": "f_crit_1",
                "target_id": "poison_batch_01",
                "severity": "CRITICAL",
                "description": "Trigger backdoor injection.",
            },
            {
                "finding_id": "f_crit_2",
                "target_id": "poison_batch_01",
                "severity": "CRITICAL",
                "description": "Data poisoning cluster.",
            },
        ],
    )

    profile = ContributorRiskEngine.get_profile(
        contributor_id="rogue_vendor",
        name="Untrusted Supplier",
        graph=temp_graph_engine,
    )

    assert profile.contributor_id == "rogue_vendor"
    assert profile.flagged_findings_count == 2
    assert profile.risk_score >= 0.70
    assert profile.status == AssetStatus.QUARANTINED


def test_export_graph_digest(temp_graph_engine):
    """Verify deterministic canonical graph export and SHA-256 digest sealing."""
    temp_graph_engine.build_lineage(
        contributor_id="author_x",
        batch_id="batch_x",
        model_id="model_x",
    )

    export1 = temp_graph_engine.export_graph()
    export2 = temp_graph_engine.export_graph()

    assert len(export1.nodes) == 3
    assert len(export1.edges) == 2
    assert len(export1.graph_digest) == 64
    assert export1.graph_digest == export2.graph_digest


def test_api_graph_endpoints(temp_graph_engine):
    """Verify full end-to-end API graph export, lineage tracing, and contributor risk endpoints."""
    # Seed default global graph engine for API test
    from app.graph.engine import default_graph_engine

    default_graph_engine.build_lineage(
        contributor_id="c_api_test",
        batch_id="b_api_test",
        model_id="m_api_test",
        inference_id="i_api_test",
        findings=[
            {
                "finding_id": "f_api_test",
                "target_id": "b_api_test",
                "severity": "HIGH",
                "description": "Label inconsistency detected.",
            }
        ],
    )

    client = TestClient(app)

    # 1. Test GET /api/v1/graph/export
    export_resp = client.get("/api/v1/graph/export")
    assert export_resp.status_code == 200
    export_data = export_resp.json()
    assert export_data["success"] is True
    assert len(export_data["data"]["graph_digest"]) == 64
    assert len(export_data["data"]["nodes"]) >= 4

    # 2. Test GET /api/v1/graph/trace/{entity_id}
    trace_resp = client.get("/api/v1/graph/trace/i_api_test")
    assert trace_resp.status_code == 200
    trace_data = trace_resp.json()
    assert trace_data["success"] is True
    assert trace_data["data"]["target_id"] == "i_api_test"
    assert len(trace_data["data"]["upstream_path"]) >= 3
    assert len(trace_data["data"]["associated_findings"]) >= 1

    # 3. Test GET /api/v1/graph/contributor/{contributor_id}/risk
    risk_resp = client.get("/api/v1/graph/contributor/c_api_test/risk?name=API_Tester")
    assert risk_resp.status_code == 200
    risk_data = risk_resp.json()
    assert risk_data["success"] is True
    assert risk_data["data"]["contributor_id"] == "c_api_test"
    assert risk_data["data"]["name"] == "API_Tester"
    assert risk_data["data"]["total_batches"] >= 1
    assert risk_data["data"]["flagged_findings_count"] >= 1


def test_export_graph_scoped_by_batch_id():
    """Verify that exporting graph with batch_id isolates that scan's subgraph."""
    from app.graph.engine import EvidenceGraphEngine
    engine = EvidenceGraphEngine()
    engine.build_lineage(
        contributor_id="c_shared",
        batch_id="batch_A",
        sample_ids=["sample_A1", "sample_A2"],
        findings=[{"finding_id": "f_A", "description": "Finding A"}],
    )
    engine.build_lineage(
        contributor_id="c_shared",
        batch_id="batch_B",
        sample_ids=["sample_B1", "sample_B2", "sample_B3"],
        findings=[{"finding_id": "f_B", "description": "Finding B"}],
    )
    # Total graph has nodes from both batches
    global_export = engine.export_graph()
    assert global_export.node_count >= 8

    # Batch A scoped export
    export_A = engine.export_graph(batch_id="batch_A")
    node_ids_A = {n.id for n in export_A.nodes}
    assert "batch_A" in node_ids_A
    assert "sample_A1" in node_ids_A
    assert "sample_A2" in node_ids_A
    assert "f_A" in node_ids_A
    assert "batch_B" not in node_ids_A
    assert "sample_B1" not in node_ids_A
    assert "sample_B2" not in node_ids_A
    assert "sample_B3" not in node_ids_A
    assert "f_B" not in node_ids_A

    # Batch B scoped export
    export_B = engine.export_graph(batch_id="batch_B")
    node_ids_B = {n.id for n in export_B.nodes}
    assert "batch_B" in node_ids_B
    assert "sample_B1" in node_ids_B
    assert "f_B" in node_ids_B
    assert "batch_A" not in node_ids_B
    assert "sample_A1" not in node_ids_B

    # Nonexistent batch returns empty graph
    export_none = engine.export_graph(batch_id="nonexistent_batch")
    assert export_none.node_count == 0
    assert len(export_none.nodes) == 0
    assert len(export_none.edges) == 0
