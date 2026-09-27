# PPT & Problem Description: Three-Way Alignment & Disclosed Scope

**SIH 2026 — Block Sentinel / TRUST-CV Assurance Architecture**

This document provides the aligned specification for **PPT Slide 3 (Technological Approach)** and the **Assurance System Description**, aligned directly with the codebase implementation and explicitly citing [`KNOWN_LIMITATIONS.md`](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md).

---

## 1. Updated PPT Slide 3: Technological Approach

### A. ASSURANCE FLOW
1. **Input:** Upload image / video / file (Direct ingestion of archives, folders, and tactical video feeds via OpenCV frame extraction)
2. **Preprocessing:** Extract and prepare multi-band and RGB visual tensors for deterministic analysis
3. **Model Inference:** Run through trained models (Live inference in ONNX & TorchScript; structural/weight state-dict inspection for PyTorch `.pt`)
4. **Evidence Generation:** Generate cryptographic proofs (`Ed25519` digital signatures, Merkle leaves) and store immutable records
5. **Verification:** Check for tampering, backdoors, and operational distribution shift
6. **Result:** Authentic / Tampered (forensic assurance certificate with calibrated disposition)

### B. SYSTEM ARCHITECTURE
* **Inputs:** Datasets, Models, Inference
* **SQLite (Local Storage):** Store metadata, logs, hashes, and audit records with WAL mode
* **Assurance Core (Analyse | Verify | Detect):**
  * Dataset Assurance
  * Model Assurance
  * Inference Assurance
  * Security - Risk Detection
* **Evidence Layer (Prove | Record):**
  * Cryptographic Proofs (Ed25519)
  * Merkle Ledger
* **Governance (Review | Decide):**
  * Audit & Review
  * Human Decision & Tamper-Evident Overrides

### C. TECH STACK (ALIGNED WITH CODEBASE)
* **FRONTEND:**
  * `React 19.2.8`
  * `Custom CSS token system (tokens.css/globals.css)`
  * `Recharts`
* **AI / LOGIC:**
  * `PyTorch / ONNX`
  * `OpenCV / Cleanlab`
  * `TorchScript Wrapper`
* **BACKEND:**
  * `FastAPI (Offline)`
  * `Ed25519 Crypto`
  * `Jinja2 / WeasyPrint`
* **STORAGE:**
  * `SQLite DB`
  * `JSON State Hash`
  * `Docker Container`

---

## 2. Updated System Description & Disclosed Design Boundaries

### Section 2.2 Core Capabilities & Scope Disclosures

#### 2.2.1 Training-Data Integrity
* Identifies trigger candidate injection, label flipping, near-duplicate flooding, and out-of-distribution insertion.
* Aggregates sample-level evidence into source-level contributor risk metrics when metadata is available.
* **Scope Limitation ([L-03](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md#L57-L73)):** Systematic label conflict detection operates on perceptual similarity (dHash ≤ 10) and Cleanlab statistical confident learning noise detection; detecting broad systematic mislabeling across visually distinct samples without perceptual similarity is out of scope.
* **Scope Limitation ([L-02](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md#L38-L55)):** Per-sample OOD scoring checks 2 statistical features (brightness, Shannon entropy); comprehensive 14-feature multivariate distribution shift operates at the batch level against a registered baseline.

#### 2.2.2 Model Integrity
* Evaluates model integrity across white-box, partial, and black-box access modes.
* Provides behavioral fingerprinting across physical transformations, layer-by-layer parameter statistics, and comparison against defined reference probe batteries.
* **Documented Security Constraint ([L-06](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md#L106-L123)):** Raw PyTorch `.pt`/`.pth` state-dict inference is intentionally blocked (`PYTORCH_RUNTIME_UNAVAILABLE`) as an air-gapped security constraint to prevent arbitrary pickle code execution; models must be exported to ONNX or compiled TorchScript for live runtime inference.
* **Scope Limitation ([L-01](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md#L16-L36)):** Trigger detection evaluates static patch matching across spatial regions (corners and sliding-window perceptual dHash) and proxy-model occlusion sensitivity (flagging `STATIC_PATCH` vs `HEURISTIC_SALIENCY_ANOMALY`); gradient-based trigger inversion or reconstruction (e.g. Neural Cleanse) is not executed in lightweight air-gapped runtimes.

#### 2.2.3 Inference Provenance and Output Integrity
* Binds input image hash, model weight digest, preprocessing spec, and prediction output into an immutable Ed25519-signed Inference DNA record with sequence numbers and nonces.
* **Scope Limitation ([L-07](file:///home/yuva/Downloads/Trust-CV/Block-Sentinal/docs/KNOWN_LIMITATIONS.md#L127-L142)):** Replay protection and sequence tracking are scoped to the local persistent generator instance (`storage_dir/state.json`) and do not synchronize state across distributed multi-cluster deployments.

#### 2.2.4 Distribution-Shift and Anomaly Assessment
* Measures statistical distribution divergence across terrain, sensor, and illumination conditions using 4 distance metrics (KS test, PSI, Wasserstein-1, Energy distance).
* Distinguishes operational environmental drift from suspicious data manipulation, providing calibrated risk scores.

#### 2.2.5 Analyst-Facing Assurance and Governance
* Reports include human-readable rationale, supporting evidence, calibrated severity, affected asset ID, and recommended disposition (`ACCEPT`, `REVIEW`, `QUARANTINE`).
* Maintains an append-only, tamper-evident Merkle audit trail and explicitly declares unsupported attack classes in the defensive coverage matrix.

#### 2.2.6 Constraints
* Fully air-gapped, zero external network or cloud dependencies.
* Ingests common CV dataset formats (COCO, YOLO, Image Folders, Video streams via OpenCV).
* Supports reference model formats (ONNX, PyTorch, TorchScript).
* Zero retraining required for baseline integrity assessment.
* Graceful fallback reporting `UNAVAILABLE` when access mode constraints apply.
