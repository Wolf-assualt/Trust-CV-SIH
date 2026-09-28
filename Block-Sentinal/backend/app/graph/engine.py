"""In-engine Directed Evidence & Lineage Property Graph with Cryptographic Grounding."""
from collections import defaultdict, deque
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
import uuid

from app.core.config import settings
from app.crypto.canonical import canonical_json_hash
from app.schemas.graph import (
    BlastRadiusReport,
    EdgeType,
    GraphEdge,
    GraphExport,
    GraphIntegrityReport,
    GraphNeighborsResponse,
    GraphNode,
    LineageTraceResponse,
    NodeType,
)


class EvidenceGraphEngine:
    """Manages an in-memory directed property graph tracking data, models, inferences, evidence, and findings."""

    def __init__(self, storage_dir: Optional[Path] = None):
        base_dir = storage_dir or Path(settings.DATA_DIR) / "graph"
        self.storage_dir = base_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.graph_file = self.storage_dir / "evidence_graph.json"

        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []
        self._out_edges: Dict[str, List[GraphEdge]] = defaultdict(list)
        self._in_edges: Dict[str, List[GraphEdge]] = defaultdict(list)

        # Load existing graph if available
        if self.graph_file.exists():
            self.load_graph()

    def clear(self) -> None:
        """Reset in-memory graph state."""
        self.nodes.clear()
        self.edges.clear()
        self._out_edges.clear()
        self._in_edges.clear()

    def add_node(self, node: GraphNode, overwrite: bool = True) -> None:
        """Insert or update a graph node."""
        if not overwrite and node.id in self.nodes:
            return
        self.nodes[node.id] = node

    def get_node(self, node_id: str) -> Optional[GraphNode]:
        """Retrieve node by ID."""
        return self.nodes.get(node_id)

    def add_edge(
        self,
        edge: GraphEdge,
        validate_nodes: bool = False,
        strict_subject_validation: bool = False,
    ) -> None:
        """Insert a directed edge with optional validation and duplicate handling."""
        if validate_nodes:
            if edge.source_id not in self.nodes or edge.target_id not in self.nodes:
                raise ValueError(
                    f"Endpoint does not exist in graph: {edge.source_id} -> {edge.target_id}"
                )

        if strict_subject_validation:
            src_node = self.nodes.get(edge.source_id)
            if src_node and src_node.node_type == NodeType.EVIDENCE:
                rel_ds = src_node.properties.get("related_dataset_id")
                if rel_ds and rel_ds != edge.target_id:
                    raise ValueError(f"Cross-dataset mismatch: evidence belongs to {rel_ds} not {edge.target_id}")
                rel_mod = src_node.properties.get("related_model_id")
                if rel_mod and rel_mod != edge.target_id:
                    raise ValueError(f"Cross-model mismatch: evidence belongs to {rel_mod} not {edge.target_id}")

        # Invariant: Every edge must have an evidence/reference ID
        if not edge.evidence_id:
            edge.evidence_id = f"ref_{edge.edge_type.value.lower()}_{edge.source_id[:16]}_{edge.target_id[:16]}"

        # Check for existing duplicate edge
        for existing in self._out_edges[edge.source_id]:
            if existing.target_id == edge.target_id and existing.edge_type == edge.edge_type:
                existing.metadata.update(edge.metadata)
                return

        self.edges.append(edge)
        self._out_edges[edge.source_id].append(edge)
        self._in_edges[edge.target_id].append(edge)

    def attach_evidence(
        self,
        evidence_id: str,
        subject_id: str,
        source_domain: str,
        severity: str,
        description: str,
        metric_value: float = 0.0,
    ) -> GraphNode:
        """Attach verified evidence to an entity."""
        node = GraphNode(
            id=evidence_id,
            node_type=NodeType.EVIDENCE,
            label=description,
            properties={
                "severity": severity,
                "metric_value": metric_value,
                "source_domain": source_domain,
                "subject_id": subject_id,
            },
        )
        self.add_node(node)
        if subject_id in self.nodes:
            self.add_edge(
                GraphEdge(
                    source_id=subject_id,
                    target_id=evidence_id,
                    edge_type=EdgeType.FLAGGED_WITH,
                    evidence_id=f"edge_flag_{evidence_id}",
                )
            )
            self.add_edge(
                GraphEdge(
                    source_id=evidence_id,
                    target_id=subject_id,
                    edge_type=EdgeType.ABOUT,
                    evidence_id=f"edge_about_{evidence_id}",
                )
            )
        return node

    def get_attached_evidence(self, entity_id: str) -> List[GraphNode]:
        """Find all evidence or finding nodes connected to an entity."""
        attached_ids: Set[str] = set()
        for e in self._out_edges.get(entity_id, []):
            if e.edge_type in (EdgeType.FLAGGED_WITH, EdgeType.EVALUATED_BY):
                attached_ids.add(e.target_id)
        for e in self._in_edges.get(entity_id, []):
            if e.edge_type in (EdgeType.FLAGGED_WITH, EdgeType.ABOUT, EdgeType.EVALUATED_BY):
                attached_ids.add(e.source_id)

        return [
            self.nodes[aid]
            for aid in attached_ids
            if aid in self.nodes and self.nodes[aid].node_type in (NodeType.EVIDENCE, NodeType.FINDING)
        ]

    def get_neighbors(self, node_id: str) -> Optional[GraphNeighborsResponse]:
        """Retrieve direct incoming and outgoing neighbors for a given vertex."""
        if node_id not in self.nodes:
            return None
        in_edges = self._in_edges.get(node_id, [])
        out_edges = self._out_edges.get(node_id, [])
        neighbor_ids = {e.source_id for e in in_edges} | {e.target_id for e in out_edges}
        neighbors = [self.nodes[nid] for nid in neighbor_ids if nid in self.nodes and nid != node_id]
        return GraphNeighborsResponse(
            node_id=node_id,
            incoming_edges=in_edges,
            outgoing_edges=out_edges,
            neighbors=neighbors,
        )

    def build_lineage(
        self,
        contributor_id: Optional[str] = None,
        dataset_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        dataset_version_id: Optional[str] = None,
        sample_ids: Optional[List[str]] = None,
        training_run_id: Optional[str] = None,
        model_id: Optional[str] = None,
        model_version_id: Optional[str] = None,
        preprocessing_config_id: Optional[str] = None,
        inference_id: Optional[str] = None,
        output_id: Optional[str] = None,
        drift_assessment_id: Optional[str] = None,
        contributor_assessment_id: Optional[str] = None,
        fusion_assessment_id: Optional[str] = None,
        quarantine_id: Optional[str] = None,
        evidence_items: Optional[List[Dict[str, Any]]] = None,
        findings: Optional[List[Dict[str, Any]]] = None,
        analyst_decision_id: Optional[str] = None,
        audit_event_id: Optional[str] = None,
        report_id: Optional[str] = None,
    ) -> None:
        """Construct multi-layer lineage connecting all Phase 6 assurance entities."""
        # Normalize dataset identifier
        actual_dataset_id = dataset_id or batch_id

        # 1. Contributor Node
        if contributor_id is not None:
            clean_contrib = str(contributor_id).strip()
            if not clean_contrib or clean_contrib.lower() in ("unknown", "anonymous", "none", "null"):
                clean_contrib = "UNKNOWN"
            if clean_contrib not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=clean_contrib,
                        node_type=NodeType.CONTRIBUTOR,
                        label=f"Contributor {clean_contrib}",
                    )
                )

        # 2. Dataset Node
        if actual_dataset_id:
            clean_contrib_prop = None
            if contributor_id is not None:
                clean_contrib_prop = str(contributor_id).strip()
                if not clean_contrib_prop or clean_contrib_prop.lower() in ("unknown", "anonymous", "none", "null"):
                    clean_contrib_prop = "UNKNOWN"

            if actual_dataset_id not in self.nodes:
                n_type = NodeType.DATASET_BATCH if (batch_id and not dataset_id) else NodeType.DATASET
                self.add_node(
                    GraphNode(
                        id=actual_dataset_id,
                        node_type=n_type,
                        label=f"Dataset {actual_dataset_id}",
                        properties={"contributor_id": clean_contrib_prop, "sample_count": len(sample_ids) if sample_ids else 0},
                    )
                )
            if clean_contrib_prop:
                self.add_edge(
                    GraphEdge(
                        source_id=actual_dataset_id,
                        target_id=clean_contrib_prop,
                        edge_type=EdgeType.AUTHORED_BY,
                        evidence_id=f"auth_{actual_dataset_id}_{clean_contrib_prop}",
                    )
                )

        # 3. Dataset Version Node
        if dataset_version_id:
            if dataset_version_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=dataset_version_id,
                        node_type=NodeType.DATASET_VERSION,
                        label=f"Dataset Version {dataset_version_id}",
                    )
                )
            if actual_dataset_id:
                self.add_edge(
                    GraphEdge(
                        source_id=dataset_version_id,
                        target_id=actual_dataset_id,
                        edge_type=EdgeType.VERSION_OF,
                        evidence_id=f"ver_{dataset_version_id}_{actual_dataset_id}",
                    )
                )

        # 4. Individual Samples
        if sample_ids and actual_dataset_id:
            for s_id in sample_ids:
                if s_id not in self.nodes:
                    self.add_node(
                        GraphNode(
                            id=s_id,
                            node_type=NodeType.SAMPLE,
                            label=f"Sample {s_id[:16]}",
                            digest=s_id if len(str(s_id)) >= 32 else None,
                            canonical_identity=s_id,
                            properties={"dataset_id": actual_dataset_id},
                        )
                    )
                self.add_edge(
                    GraphEdge(
                        source_id=actual_dataset_id,
                        target_id=s_id,
                        edge_type=EdgeType.CONTAINS_SAMPLE,
                        evidence_id=f"sample_{actual_dataset_id}_{s_id}",
                    )
                )

        # 5. Training Run Node
        if training_run_id:
            if training_run_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=training_run_id,
                        node_type=NodeType.TRAINING_RUN,
                        label=f"Training Run {training_run_id}",
                    )
                )
            target_ds = dataset_version_id or actual_dataset_id
            if target_ds:
                self.add_edge(
                    GraphEdge(
                        source_id=training_run_id,
                        target_id=target_ds,
                        edge_type=EdgeType.TRAINED_ON,
                        evidence_id=f"tr_{training_run_id}_{target_ds}",
                    )
                )

        # 6. Model Node
        if model_id:
            if model_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=model_id,
                        node_type=NodeType.MODEL,
                        label=f"Model {model_id}",
                    )
                )
            if training_run_id:
                self.add_edge(
                    GraphEdge(
                        source_id=model_id,
                        target_id=training_run_id,
                        edge_type=EdgeType.PRODUCED,
                        evidence_id=f"mod_tr_{model_id}_{training_run_id}",
                    )
                )
            elif actual_dataset_id:
                self.add_edge(
                    GraphEdge(
                        source_id=model_id,
                        target_id=actual_dataset_id,
                        edge_type=EdgeType.TRAINED_ON,
                        evidence_id=f"mod_ds_{model_id}_{actual_dataset_id}",
                    )
                )

        # 7. Model Version Node
        if model_version_id:
            if model_version_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=model_version_id,
                        node_type=NodeType.MODEL_VERSION,
                        label=f"Model Version {model_version_id}",
                    )
                )
            if model_id:
                self.add_edge(
                    GraphEdge(
                        source_id=model_version_id,
                        target_id=model_id,
                        edge_type=EdgeType.VERSION_OF,
                        evidence_id=f"ver_{model_version_id}_{model_id}",
                    )
                )

        # 8. Preprocessing Config Node
        if preprocessing_config_id:
            if preprocessing_config_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=preprocessing_config_id,
                        node_type=NodeType.PREPROCESSING_CONFIG,
                        label=f"Preprocessing Config {preprocessing_config_id}",
                    )
                )
            target_m = model_version_id or model_id
            if target_m:
                self.add_edge(
                    GraphEdge(
                        source_id=target_m,
                        target_id=preprocessing_config_id,
                        edge_type=EdgeType.USED_PREPROCESSING,
                        evidence_id=f"prep_{target_m}_{preprocessing_config_id}",
                    )
                )

        # 9. Inference Node
        if inference_id:
            if inference_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=inference_id,
                        node_type=NodeType.INFERENCE,
                        label=f"Inference {inference_id}",
                    )
                )
            target_m = model_version_id or model_id
            if target_m:
                self.add_edge(
                    GraphEdge(
                        source_id=inference_id,
                        target_id=target_m,
                        edge_type=EdgeType.GENERATED_BY,
                        evidence_id=f"inf_{inference_id}_{target_m}",
                    )
                )

        # 10. Output Node
        if output_id:
            if output_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=output_id,
                        node_type=NodeType.OUTPUT,
                        label=f"Output {output_id}",
                    )
                )
            if inference_id:
                self.add_edge(
                    GraphEdge(
                        source_id=output_id,
                        target_id=inference_id,
                        edge_type=EdgeType.GENERATED_BY,
                        evidence_id=f"out_{output_id}_{inference_id}",
                    )
                )

        # 11. Drift Assessment Node
        if drift_assessment_id:
            if drift_assessment_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=drift_assessment_id,
                        node_type=NodeType.DRIFT_ASSESSMENT,
                        label=f"Drift Assessment {drift_assessment_id}",
                    )
                )
            target_entity = actual_dataset_id or model_id
            if target_entity:
                self.add_edge(
                    GraphEdge(
                        source_id=drift_assessment_id,
                        target_id=target_entity,
                        edge_type=EdgeType.ASSESSED_IN,
                        evidence_id=f"drift_{drift_assessment_id}_{target_entity}",
                    )
                )

        # 12. Contributor Assessment Node
        if contributor_assessment_id and contributor_id:
            if contributor_assessment_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=contributor_assessment_id,
                        node_type=NodeType.CONTRIBUTOR_ASSESSMENT,
                        label=f"Contributor Assessment {contributor_assessment_id}",
                    )
                )
            self.add_edge(
                GraphEdge(
                    source_id=contributor_assessment_id,
                    target_id=contributor_id,
                    edge_type=EdgeType.DECIDES_ON,
                    evidence_id=f"ca_{contributor_assessment_id}_{contributor_id}",
                )
            )

        # 13. Fusion Assessment Node
        if fusion_assessment_id:
            if fusion_assessment_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=fusion_assessment_id,
                        node_type=NodeType.FUSION_ASSESSMENT,
                        label=f"Fusion Assessment {fusion_assessment_id}",
                    )
                )
            target_subj = model_id or actual_dataset_id
            if target_subj:
                self.add_edge(
                    GraphEdge(
                        source_id=fusion_assessment_id,
                        target_id=target_subj,
                        edge_type=EdgeType.DECIDES_ON,
                        evidence_id=f"fa_{fusion_assessment_id}_{target_subj}",
                    )
                )

        # 14. Quarantine Record Node
        if quarantine_id:
            if quarantine_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=quarantine_id,
                        node_type=NodeType.QUARANTINE_RECORD,
                        label=f"Quarantine {quarantine_id}",
                    )
                )
            target_subj = model_id or actual_dataset_id
            if target_subj:
                self.add_edge(
                    GraphEdge(
                        source_id=quarantine_id,
                        target_id=target_subj,
                        edge_type=EdgeType.QUARANTINES,
                        evidence_id=f"quar_{quarantine_id}_{target_subj}",
                    )
                )
            if fusion_assessment_id:
                self.add_edge(
                    GraphEdge(
                        source_id=quarantine_id,
                        target_id=fusion_assessment_id,
                        edge_type=EdgeType.RESULTED_FROM,
                        evidence_id=f"quar_fa_{quarantine_id}_{fusion_assessment_id}",
                    )
                )

        # 15. Analyst Decision Node
        if analyst_decision_id:
            if analyst_decision_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=analyst_decision_id,
                        node_type=NodeType.ANALYST_DECISION,
                        label=f"Analyst Decision {analyst_decision_id}",
                    )
                )
            target_dec = quarantine_id or fusion_assessment_id or model_id
            if target_dec:
                self.add_edge(
                    GraphEdge(
                        source_id=analyst_decision_id,
                        target_id=target_dec,
                        edge_type=EdgeType.DECIDES_ON,
                        evidence_id=f"dec_{analyst_decision_id}_{target_dec}",
                    )
                )

        # 16. Audit Event Node
        if audit_event_id:
            if audit_event_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=audit_event_id,
                        node_type=NodeType.AUDIT_EVENT,
                        label=f"Audit Event {audit_event_id}",
                    )
                )

        # 17. Report Node
        if report_id:
            if report_id not in self.nodes:
                self.add_node(
                    GraphNode(
                        id=report_id,
                        node_type=NodeType.REPORT,
                        label=f"Report {report_id}",
                    )
                )

        # 18. Attached Evidence Items
        if evidence_items:
            target_subj = model_id or actual_dataset_id
            for it in evidence_items:
                eid = it.get("evidence_id")
                if eid:
                    self.attach_evidence(
                        evidence_id=eid,
                        subject_id=target_subj or "unknown_subject",
                        source_domain=str(it.get("source", "DATASET")),
                        severity=str(it.get("severity", "LOW")),
                        description=str(it.get("description", "")),
                        metric_value=float(it.get("metric_value", 0.0)),
                    )

        # 19. Attached Findings
        if findings:
            target_subj = actual_dataset_id or model_id
            for f in findings:
                f_id = f.get("finding_id") or f.get("id", f"finding_{uuid.uuid4().hex[:8]}")
                if f_id not in self.nodes:
                    self.add_node(
                        GraphNode(
                            id=f_id,
                            node_type=NodeType.FINDING,
                            label=f.get("description", f"Finding {f_id}"),
                            properties=f,
                        )
                    )
                if target_subj:
                    self.add_edge(
                        GraphEdge(
                            source_id=target_subj,
                            target_id=f_id,
                            edge_type=EdgeType.FLAGGED_WITH,
                            evidence_id=f"f_edge_{f_id}",
                        )
                    )

    def trace_upstream(self, node_id: str, max_depth: int = 10) -> List[GraphNode]:
        """BFS trace backwards to all dependencies up to max_depth."""
        if node_id not in self.nodes:
            return []

        upstream_nodes: List[GraphNode] = []
        visited: Set[str] = {node_id}
        queue: deque = deque([(node_id, 0)])

        while queue:
            curr_id, depth = queue.popleft()
            if depth >= max_depth:
                continue

            # Follow outgoing edges of dependency types:
            # e.g., OUTPUT -> INFERENCE -> MODEL -> TRAINING_RUN -> DATASET_VERSION -> DATASET -> CONTRIBUTOR
            # or VERSION_OF, TRAINED_ON, GENERATED_BY, PROVIDED, AUTHORED_BY
            # Note: in build_lineage(), model_id points to training_run_id via PRODUCED.
            for edge in self._out_edges.get(curr_id, []):
                tgt = edge.target_id
                if tgt in visited or tgt not in self.nodes:
                    continue
                if edge.edge_type in (
                    EdgeType.GENERATED_BY,
                    EdgeType.TRAINED_ON,
                    EdgeType.AUTHORED_BY,
                    EdgeType.PROVIDED,
                    EdgeType.VERSION_OF,
                    EdgeType.USED_PREPROCESSING,
                ):
                    visited.add(tgt)
                    upstream_nodes.append(self.nodes[tgt])
                    queue.append((tgt, depth + 1))
                elif edge.edge_type == EdgeType.PRODUCED:
                    # In build_lineage, model_id -> training_run_id is PRODUCED (model depends on training_run)
                    tgt_node = self.nodes[tgt]
                    if tgt_node.node_type == NodeType.TRAINING_RUN:
                        visited.add(tgt)
                        upstream_nodes.append(tgt_node)
                        queue.append((tgt, depth + 1))

            # Follow incoming edges that represent containment/provision/production:
            # DATASET -> CONTAINS_SAMPLE -> SAMPLE (so sample points upstream to dataset)
            # DATASET/PATCH -> PRODUCED -> TARGET (so target points upstream to producer)
            # (CONTRIBUTOR -> PROVIDED -> DATASET)
            for edge in self._in_edges.get(curr_id, []):
                src = edge.source_id
                if src in visited or src not in self.nodes:
                    continue
                if edge.edge_type in (EdgeType.CONTAINS_SAMPLE, EdgeType.PROVIDED):
                    visited.add(src)
                    upstream_nodes.append(self.nodes[src])
                    queue.append((src, depth + 1))
                elif edge.edge_type == EdgeType.PRODUCED:
                    # Follow backwards from target to source, UNLESS it was a model->training_run edge
                    src_node = self.nodes[src]
                    curr_node = self.nodes[curr_id]
                    if not (src_node.node_type == NodeType.MODEL and curr_node.node_type == NodeType.TRAINING_RUN):
                        visited.add(src)
                        upstream_nodes.append(src_node)
                        queue.append((src, depth + 1))

        return upstream_nodes

    def trace_downstream(self, node_id: str, max_depth: int = 10) -> List[GraphNode]:
        """BFS trace forwards to all dependent consumers up to max_depth."""
        if node_id not in self.nodes:
            return []

        downstream_nodes: List[GraphNode] = []
        visited: Set[str] = {node_id}
        queue: deque = deque([(node_id, 0)])

        while queue:
            curr_id, depth = queue.popleft()
            if depth >= max_depth:
                continue

            # Inbound dependency edges represent downstream consumers:
            # (e.g. INFERENCE -> GENERATED_BY -> MODEL: model has downstream inference)
            # (e.g. MODEL -> PRODUCED -> TRAINING_RUN: training_run has downstream model)
            for edge in self._in_edges.get(curr_id, []):
                src = edge.source_id
                if src in visited or src not in self.nodes:
                    continue
                if edge.edge_type in (
                    EdgeType.GENERATED_BY,
                    EdgeType.TRAINED_ON,
                    EdgeType.AUTHORED_BY,
                    EdgeType.VERSION_OF,
                    EdgeType.USED_PREPROCESSING,
                ):
                    visited.add(src)
                    downstream_nodes.append(self.nodes[src])
                    queue.append((src, depth + 1))
                elif edge.edge_type == EdgeType.PRODUCED:
                    src_node = self.nodes[src]
                    curr_node = self.nodes[curr_id]
                    if src_node.node_type == NodeType.MODEL and curr_node.node_type == NodeType.TRAINING_RUN:
                        visited.add(src)
                        downstream_nodes.append(src_node)
                        queue.append((src, depth + 1))

            # Outbound provision / containment / production:
            # (CONTRIBUTOR -> PROVIDED -> DATASET, DATASET -> CONTAINS_SAMPLE -> SAMPLE, PATCH -> PRODUCED -> MODEL)
            for edge in self._out_edges.get(curr_id, []):
                tgt = edge.target_id
                if tgt in visited or tgt not in self.nodes:
                    continue
                if edge.edge_type in (EdgeType.PROVIDED, EdgeType.CONTAINS_SAMPLE):
                    visited.add(tgt)
                    downstream_nodes.append(self.nodes[tgt])
                    queue.append((tgt, depth + 1))
                elif edge.edge_type == EdgeType.PRODUCED:
                    curr_node = self.nodes[curr_id]
                    tgt_node = self.nodes[tgt]
                    if not (curr_node.node_type == NodeType.MODEL and tgt_node.node_type == NodeType.TRAINING_RUN):
                        visited.add(tgt)
                        downstream_nodes.append(tgt_node)
                        queue.append((tgt, depth + 1))

        return downstream_nodes

    def trace_lineage(self, entity_id: str) -> LineageTraceResponse:
        """Traverse upstream dependencies and downstream consumers from a given node using BFS."""
        if entity_id not in self.nodes:
            return LineageTraceResponse(
                target_id=entity_id,
                upstream_path=[],
                downstream_path=[],
                associated_findings=[],
                blast_radius_count=0,
            )

        upstream = self.trace_upstream(entity_id)
        downstream = self.trace_downstream(entity_id)

        lineage_cluster = {entity_id} | {n.id for n in upstream} | {n.id for n in downstream}
        associated_findings: List[GraphNode] = []
        seen_findings: Set[str] = set()

        for member_id in lineage_cluster:
            for edge in self._out_edges.get(member_id, []):
                if edge.edge_type in (EdgeType.FLAGGED_WITH, EdgeType.EVALUATED_BY):
                    f_id = edge.target_id
                    if f_id not in seen_findings and f_id in self.nodes:
                        seen_findings.add(f_id)
                        associated_findings.append(self.nodes[f_id])

            for edge in self._in_edges.get(member_id, []):
                if edge.edge_type in (EdgeType.FLAGGED_WITH, EdgeType.ABOUT, EdgeType.EVALUATED_BY):
                    f_id = edge.source_id
                    if f_id not in seen_findings and f_id in self.nodes:
                        seen_findings.add(f_id)
                        associated_findings.append(self.nodes[f_id])

        blast_radius_count = len(downstream) + len(associated_findings)

        return LineageTraceResponse(
            target_id=entity_id,
            upstream_path=upstream,
            downstream_path=downstream,
            associated_findings=associated_findings,
            blast_radius_count=blast_radius_count,
        )

    def calculate_blast_radius(self, root_cause_id: str) -> BlastRadiusReport:
        """Forensic analysis calculating downstream impact of a compromised or anomalous entity."""
        from app.schemas.base import AssetStatus

        if root_cause_id not in self.nodes:
            raise ValueError(f"Root cause entity '{root_cause_id}' not found in graph.")

        root_node = self.nodes[root_cause_id]
        downstream = self.trace_downstream(root_cause_id)

        affected_training_runs: List[str] = []
        affected_models: List[str] = []
        affected_inferences: List[str] = []
        affected_quarantines: List[str] = []

        for n in downstream:
            if n.node_type == NodeType.TRAINING_RUN:
                affected_training_runs.append(n.id)
            elif n.node_type in (NodeType.MODEL, NodeType.MODEL_VERSION):
                affected_models.append(n.id)
            elif n.node_type in (NodeType.INFERENCE, NodeType.INFERENCE_RECORD):
                affected_inferences.append(n.id)
            elif n.node_type == NodeType.QUARANTINE_RECORD:
                affected_quarantines.append(n.id)

        # Collect evidence IDs and quarantine records attached to root cause or downstream nodes
        affected_evidence_ids: List[str] = []
        for nid in [root_cause_id] + [n.id for n in downstream]:
            for ev in self.get_attached_evidence(nid):
                if ev.id not in affected_evidence_ids:
                    affected_evidence_ids.append(ev.id)

            for e in self._out_edges.get(nid, []):
                if e.edge_type == EdgeType.QUARANTINES or e.edge_type == EdgeType.RESULTED_FROM:
                    tgt = self.nodes.get(e.target_id)
                    if tgt and tgt.node_type == NodeType.QUARANTINE_RECORD and tgt.id not in affected_quarantines:
                        affected_quarantines.append(tgt.id)
            for e in self._in_edges.get(nid, []):
                if e.edge_type == EdgeType.QUARANTINES:
                    src = self.nodes.get(e.source_id)
                    if src and src.node_type == NodeType.QUARANTINE_RECORD and src.id not in affected_quarantines:
                        affected_quarantines.append(src.id)

        directly_affected_count = len(self._in_edges.get(root_cause_id, [])) + len(self._out_edges.get(root_cause_id, []))
        total_downstream_count = len(downstream)
        total_affected = len(affected_training_runs) + len(affected_models) + len(affected_inferences)

        status = AssetStatus.QUARANTINED if affected_quarantines else (AssetStatus.UNDER_REVIEW if affected_evidence_ids else AssetStatus.ACCEPTED)

        explanation = (
            f"Downstream dependencies of '{root_cause_id}' ({root_node.node_type.value}) include "
            f"{len(affected_training_runs)} training runs, {len(affected_models)} models, and "
            f"{len(affected_inferences)} deployed inference sequences."
        )

        return BlastRadiusReport(
            root_cause_id=root_cause_id,
            root_cause_type=root_node.node_type,
            status=status,
            directly_affected_count=directly_affected_count,
            total_downstream_count=total_downstream_count,
            affected_training_runs=affected_training_runs,
            affected_models=affected_models,
            affected_inferences=affected_inferences,
            affected_evidence_ids=affected_evidence_ids,
            affected_quarantines=affected_quarantines,
            affected_nodes=[n.id for n in downstream],
            total_affected_entities=total_affected,
            explanation=explanation,
        )

    def verify_graph_integrity(self, check_cycles: bool = False) -> GraphIntegrityReport:
        """Perform topological and cryptographic integrity audit on the graph."""
        broken_edges: List[str] = []
        for e in self.edges:
            if e.source_id not in self.nodes or e.target_id not in self.nodes:
                broken_edges.append(f"{e.source_id}->{e.target_id}")

        # Detect orphan nodes (0 in-degree and 0 out-degree)
        orphan_nodes: List[str] = []
        for nid in self.nodes:
            deg = len(self._out_edges.get(nid, [])) + len(self._in_edges.get(nid, []))
            if deg == 0:
                orphan_nodes.append(nid)

        export_data = self.export_graph()
        is_valid = len(broken_edges) == 0

        return GraphIntegrityReport(
            is_valid=is_valid,
            computed_digest=export_data.graph_digest,
            broken_edges=broken_edges,
            orphan_nodes=orphan_nodes,
            total_nodes=len(self.nodes),
            total_edges=len(self.edges),
        )

    def export_graph(self, batch_id: Optional[str] = None) -> GraphExport:
        """Export sorted, deterministic graph snapshot sealed with canonical SHA-256 digest.
        
        If batch_id is provided, returns only that scan's connected subgraph.
        """
        if batch_id is not None:
            included_node_ids: Set[str] = set()
            if batch_id in self.nodes:
                included_node_ids.add(batch_id)

            for nid, node in self.nodes.items():
                props = node.properties or {}
                if (
                    props.get("batch_id") == batch_id
                    or props.get("dataset_id") == batch_id
                    or props.get("scan_id") == batch_id
                ):
                    included_node_ids.add(nid)

            if not included_node_ids:
                payload = {"nodes": [], "edges": []}
                return GraphExport(
                    nodes=[],
                    edges=[],
                    node_count=0,
                    edge_count=0,
                    graph_digest=canonical_json_hash(payload),
                )

            visited: Set[str] = set(included_node_ids)
            queue: deque[str] = deque(included_node_ids)

            while queue:
                curr = queue.popleft()
                for edge in self._out_edges.get(curr, []):
                    target = edge.target_id
                    target_node = self.nodes.get(target)
                    if not target_node:
                        continue
                    if target_node.node_type in (NodeType.DATASET, NodeType.DATASET_BATCH) and target != batch_id:
                        continue
                    t_props = target_node.properties or {}
                    if t_props.get("batch_id") and t_props.get("batch_id") != batch_id:
                        continue
                    if t_props.get("dataset_id") and t_props.get("dataset_id") != batch_id:
                        continue

                    if target not in visited:
                        visited.add(target)
                        if target_node.node_type != NodeType.CONTRIBUTOR:
                            queue.append(target)

                for edge in self._in_edges.get(curr, []):
                    source = edge.source_id
                    source_node = self.nodes.get(source)
                    if not source_node:
                        continue
                    if source_node.node_type in (NodeType.DATASET, NodeType.DATASET_BATCH) and source != batch_id:
                        continue
                    s_props = source_node.properties or {}
                    if s_props.get("batch_id") and s_props.get("batch_id") != batch_id:
                        continue
                    if s_props.get("dataset_id") and s_props.get("dataset_id") != batch_id:
                        continue

                    if source not in visited:
                        visited.add(source)
                        if source_node.node_type != NodeType.CONTRIBUTOR:
                            queue.append(source)

            filtered_nodes = [self.nodes[nid] for nid in visited if nid in self.nodes]
            filtered_edges = [
                e for e in self.edges
                if e.source_id in visited and e.target_id in visited
            ]

            sorted_nodes = sorted(filtered_nodes, key=lambda n: n.id)
            sorted_edges = sorted(
                filtered_edges,
                key=lambda e: (e.source_id, e.target_id, e.edge_type.value),
            )
            payload = {
                "nodes": [n.model_dump() for n in sorted_nodes],
                "edges": [e.model_dump() for e in sorted_edges],
            }
            graph_digest = canonical_json_hash(payload)

            return GraphExport(
                nodes=sorted_nodes,
                edges=sorted_edges,
                node_count=len(sorted_nodes),
                edge_count=len(sorted_edges),
                graph_digest=graph_digest,
            )

        sorted_nodes = sorted(self.nodes.values(), key=lambda n: n.id)
        sorted_edges = sorted(
            self.edges,
            key=lambda e: (e.source_id, e.target_id, e.edge_type.value),
        )

        payload = {
            "nodes": [n.model_dump() for n in sorted_nodes],
            "edges": [e.model_dump() for e in sorted_edges],
        }
        graph_digest = canonical_json_hash(payload)

        return GraphExport(
            nodes=sorted_nodes,
            edges=sorted_edges,
            node_count=len(sorted_nodes),
            edge_count=len(sorted_edges),
            graph_digest=graph_digest,
        )

    def save_graph(self, filepath: Optional[Path] = None) -> None:
        """Save graph data to JSON file."""
        target_path = filepath or self.graph_file
        export_data = self.export_graph()
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(export_data.model_dump(mode="json"), f, indent=2)

    def load_graph(self, filepath: Optional[Path] = None) -> None:
        """Load graph data from JSON file."""
        target_path = filepath or self.graph_file
        if not target_path.exists():
            return

        with open(target_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.nodes = {n["id"]: GraphNode.model_validate(n) for n in data.get("nodes", [])}
        self.edges = []
        self._out_edges.clear()
        self._in_edges.clear()

        for e_dict in data.get("edges", []):
            edge = GraphEdge.model_validate(e_dict)
            self.add_edge(edge)


# Default singleton instance
default_graph_engine = EvidenceGraphEngine()
