# TRUST-CV (SIH26228)
### Zero-Trust Computer Vision Integrity Assurance, Cryptographic Lineage & Evidence Graph Platform
**Ministry of Defence (MoD) — Smart India Hackathon (SIH 2024 / SIH26228)**

---

## Executive Summary

**TRUST-CV** is an air-gapped, zero-trust cryptographic assurance platform purpose-engineered for mission-critical military computer vision (CV) pipelines. In contested defense environments, CV models (YOLO, ResNet, Vision Transformers) are vulnerable to sophisticated adversarial attacks, including:

- **Data Poisoning & Clean-Label Backdoors**: Adversaries inject imperceptible physical patches into training datasets.
- **Model Weight Tampering & Substitution**: Unauthorized alterations to neural network weights or malicious architecture swaps.
- **Inference Spoofing & Replay Attacks**: Adversaries replay stale target detection outputs or forge inference results to mislead command systems.
- **Adversarial Distribution Shift & Sensor Degradation**: Environmental anomalies, sensor blinding, or out-of-distribution inputs.

TRUST-CV establishes an end-to-end chain of cryptographic custody across the entire AI/ML lifecycle—from raw dataset annotation to battlefield inference delivery—guaranteeing tamper evidence, contributor non-repudiation, automated quarantine, and continuous forensic auditability without reliance on external cloud services.

---

## Capability Matrix (Current Implementation Status)

| Phase | Subsystem | Core Capabilities | Engine / Modules | Status |
| :---: | :--- | :--- | :--- | :---: |
| **01** | **Foundation & Relational DB** | SQLite WAL mode, schema validation, foreign key enforcement, air-gapped config. | `app.core`, `app.db`, `app.schemas` | **Verified** |
| **02** | **Cryptographic Trust Foundation** | Canonical JSON (RFC 8785), SHA-256 Merkle trees, ECDSA SECP256R1, sequential hash chains. | `app.crypto.canonical`, `signer`, `merkle`, `chain` | **Verified** |
| **03** | **Dataset Ingestion Pipeline** | Multi-format parsing (Directory, YOLO TXT, COCO JSON), sample digest hashing, Merkle manifest sealing. | `app.datasets.parsers`, `app.datasets.engine` | **Verified** |
| **04** | **Training Data Integrity Engine** | DCT perceptual hashing, exact/near-duplicate detection, label inconsistency auditing, physical trigger detection. | `app.integrity.hasher`, `detectors`, `engine` | **Verified** |
| **05** | **Model Ingestion & Identity** | Layer-wise weight tensor hashing, architecture structure normalization, signed identity manifests. | `app.models_engine.identity`, `engine` | **Verified** |
| **06** | **Behavioural Fingerprinting** | Deterministic synthetic probe battery, spatial/noise transformations, IoU / L1 divergence comparison. | `app.fingerprint.battery`, `comparator`, `engine` | **Verified** |
| **07** | **Inference DNA & Provenance** | 5-tuple provenance record ⟨Input, Model, Output, Nonce, SeqID⟩, ECDSA signature, replay prevention. | `app.inference.engine`, `schemas.inference` | **Verified** |
| **08** | **Distribution-Shift Engine** | Pure NumPy statistical distance (Wasserstein, KS, PSI, Energy distance), operational drift classification. | `app.drift.statistical`, `features`, `engine` | **Verified** |
| **09** | **Evidence Fusion Engine** | Multi-source Bayesian risk aggregation, cross-layer correlation rules, weighted reliability scoring, quarantine veto. | `app.fusion.aggregator`, `correlator`, `engine` | **Verified** |
| **10** | **Contributor Risk & Evidence Graph** | In-engine directed property graph, upstream lineage traversal, downstream blast-radius impact analysis. | `app.graph.engine`, `contributor`, `schemas.graph` | **Verified** |
| **11** | **Assurance Reports Engine** | Cryptographically sealed assurance manifests, signature verification, multi-format export (JSON, Markdown). | `app.reports.engine`, `formatter`, `schemas.report` | **Verified** |
| **12** | **Analyst SOC Dashboard API** | Forensic investigation views, real-time activity timelines, system health metrics. | `app.dashboard.service`, `api.dashboard` | **Verified** |
| **13** | **Red-Team Adversarial Lab** | Controlled quarantine attack simulation: label flipping, backdoor injection, weight noise, inference replay. | `app.redteam.attacks`, `runner`, `api.redteam` | **Verified** |
| **14** | **Pipeline Validation & Hardening** | Air-gap compliance auditor, hash chain stress validation, cryptographic throughput benchmarks. | `app.core.hardening`, `tests.test_e2e_pipeline` | **Verified** |
| **15** | **Defense SOC Command Center UI** | Tactical HUD, HTML5 Canvas provenance graph with animated particles, live telemetry, containment modals. | `frontend/src/`, `templates/` | **Verified** |

---

## Architectural Highlights

### 1. Cryptographic Lineage & Non-Repudiation
Every asset ingested or generated in TRUST-CV receives an immutable cryptographic fingerprint:
- **Canonical Serialization**: RFC 8785 compliant canonical JSON serialization prevents byte-order divergence across platforms.
- **ECDSA SECP256R1 Digital Signatures**: Operators and automated nodes cryptographically sign manifests, inference records, and assurance reports.
- **Sequential Block Hash Chain**: Each security event is permanently sealed in an append-only cryptographic ledger:
  $$H_i = \text{SHA256}(i \parallel \text{timestamp} \parallel \text{event\_digest} \parallel H_{i-1})$$

### 2. Multi-Source Evidence Fusion & Automatic Quarantine
Rather than relying on isolated heuristic checks, the **Evidence Fusion Engine** correlates signals across five defense layers:
- Data Integrity Findings (Backdoors, Duplicates, Trigger Candidates)
- Model Identity Mismatches (Weight tampering, Architecture alteration)
- Behavioral Fingerprint Divergence (Output shift under deterministic synthetic batteries)
- Inference DNA Verification (Output tampering, Nonce reuse, Replay attempts)
- Distribution-Shift Signatures (PSI and KS statistic anomalies)

When a critical integrity violation is detected, an automatic quarantine veto is enforced:
$$\text{Status} = \mathbf{QUARANTINED}, \quad \text{Risk Score} \ge 0.85$$

### 3. Tactical Defense SOC Command Center
Served directly by FastAPI with zero Node.js/npm dependencies:
- **Obsidian Dark Mode HUD**: Styling tailored for military command environments (`#030712` theme, glowing cybernetic borders, CRT scanline overlay).
- **Interactive Provenance Canvas**: Directed property graph with dynamic particle flows along edges representing active cryptographic verification.
- **1-Click Adversarial Attack Lab**: Live simulation of backdoor triggers, weight bit-flips, and replay attacks demonstrating instant intercept and containment.
- **Real-Time Air-Gap Badge**: Continuously monitors offline status with zero external network connectivity.

---

## Quick Start (Single-Click Launch)

### On Windows
Double-click `run_trust_cv.bat` or execute in PowerShell/Command Prompt:
```cmd
run_trust_cv.bat
```

### On Linux / macOS (Air-Gapped Systems)
Make executable and run:
```bash
chmod +x run_trust_cv.sh
./run_trust_cv.sh
```

The script automatically:
1. Verifies the Python 3.10+ runtime.
2. Creates the isolated storage tree under `Block-Sentinal/data/`.
3. Validates required dependencies.
4. Executes quick cryptographic and health diagnostics.
5. Launches the defense server and opens `http://localhost:8000` in your default browser.

---

## Manual Execution & Verification

### Running the Server
```powershell
# Set Python path to backend directory
$env:PYTHONPATH="Block-Sentinal/backend"

# Launch Uvicorn
python -m uvicorn app.main:app --app-dir Block-Sentinal/backend --host 127.0.0.1 --port 8000
```
- **Defense SOC Command Center**: [http://localhost:8000](http://localhost:8000)
- **Interactive OpenAPI Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **System Status API**: [http://localhost:8000/api/v1/system/status](http://localhost:8000/api/v1/system/status)

### Running Automated Test Suites
TRUST-CV includes **607 automated backend tests** with a **100% pass rate**:

```powershell
# Run the complete backend test suite
cd Block-Sentinal/backend
python -m pytest -v

# Run E2E Pipeline & Air-Gap Hardening tests
python -m pytest backend/tests/test_e2e_pipeline.py -v

# Run Red-Team Adversarial simulation tests
python -m pytest backend/tests/test_redteam.py -v

# Run frontend unit tests (72 tests)
cd ../../frontend
npm test
```

---

## Hardware & Environment Requirements

- **Operating System**: Windows 10/11, Ubuntu 20.04+, RHEL 8+, or macOS
- **Python**: 3.10, 3.11, 3.12, or 3.13
- **Network**: **100% Offline / Air-Gapped Capable** (No internet connection or cloud API keys required)
- **Build Tools**: **Zero Node.js / Zero npm** required at runtime (frontend served statically by FastAPI)
- **Database**: Embedded SQLite with WAL mode (Zero external database servers required)

---

## Directory Structure

```text
TRUST-CV/
├── run_trust_cv.bat              # 1-Click Windows Command Center Launcher
├── run_trust_cv.sh               # Linux / macOS Air-Gapped Shell Launcher
├── requirements.txt              # Pinned runtime dependencies
├── README.md                     # System Architecture & Documentation
├── pytest.ini                    # Pytest configuration
├── Block-Sentinal/               # Primary backend + data + frontend
│   ├── backend/
│   │   ├── app/
│   │   │   ├── api/              # REST API endpoints (Health, Crypto, Ingestion, Fusion, etc.)
│   │   │   ├── core/             # Configuration, logging, system hardening & auditor
│   │   │   ├── crypto/           # Canonical JSON, Merkle trees, ECDSA signer, Hash chains
│   │   │   ├── dashboard/        # SOC overview, timeline, and forensic investigation
│   │   │   ├── datasets/         # Multi-format parsers (YOLO, COCO) & ingestion engine
│   │   │   ├── db/               # SQLite session & WAL engine
│   │   │   ├── drift/            # Pure NumPy statistical distribution-shift engine
│   │   │   ├── fingerprint/      # Deterministic synthetic probe battery & comparator
│   │   │   ├── fusion/           # Bayesian multi-source evidence fusion & quarantine veto
│   │   │   ├── graph/            # In-memory directed property graph & blast radius
│   │   │   ├── inference/        # Inference DNA 5-tuple extraction & verification
│   │   │   ├── integrity/        # Perceptual hasher, duplicate & backdoor detector
│   │   │   ├── models/           # SQLAlchemy ORM models
│   │   │   ├── models_engine/    # Weight tensor hashing & architectural normalizer
│   │   │   ├── redteam/          # Adversarial attack lab (Backdoors, Tampering, Replay)
│   │   │   ├── reports/          # Assurance report generator & cryptographic sealer
│   │   │   ├── schemas/          # Pydantic v2 data models
│   │   │   ├── static/           # Tactical HUD CSS & Vanilla JS (Canvas graph, API client)
│   │   │   ├── templates/        # SOC Command Center single-page HTML interface
│   │   │   └── main.py           # FastAPI application entrypoint
│   │   └── tests/                # 607 automated unit, integration, and E2E tests
│   ├── data/                     # Air-gapped secure local artifact storage
│   │   ├── manifests/            # Signed dataset Merkle manifests
│   │   ├── models/               # Model weights and identity manifests
│   │   ├── inference_dna/        # Cryptographically signed inference tuples
│   │   ├── fingerprints/         # Behavioral probe battery benchmarks
│   │   ├── drift/                # Distribution-shift statistical baselines
│   │   ├── graph/                # Lineage & evidence graph exports
│   │   ├── reports/assurance/    # Signed assurance reports (JSON & Markdown)
│   │   └── quarantine/attacks/   # Isolated red-team sandbox artifacts
│   ├── frontend/                 # React + TypeScript + Vite frontend
│   │   ├── src/
│   │   │   ├── components/       # UI components (Launch, Scan, Results, Layout)
│   │   │   ├── pages/            # LaunchPage, ScanPage, ResultsPage
│   │   │   ├── state/            # Zustand stores (investigation, session)
│   │   │   ├── services/         # API client (api.ts)
│   │   │   ├── theme/            # CSS variables, tokens, globals
│   │   │   └── types/            # TypeScript interfaces
│   │   └── package.json
│   ├── reference_dataset/        # 10 clean 64×64 reference images for smoke testing
│   ├── deployment/               # Docker, Jetson, x86_64, ARM64 deployment guides
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .gitignore
└── frontend/                     # (symlink to Block-Sentinal/frontend for convenience)
```

---

## Limitations & Roadmap (Honest Disclosure)

The following capabilities are **documented limits** rather than bugs. They exist because the pipeline requires additional operator-supplied context that cannot be synthesized safely.

| Area | Current Behavior | Why It's a Limit | Future Work |
|------|------------------|------------------|-------------|
| **OOD Detection** | Reports `UNAVAILABLE` | Requires an independently sourced reference dataset. The detector class exists and works when given one, but the API has no field to supply it. | Add `reference_dataset` / `ood_reference_stats` to upload form; thread through to `scan()`; surface detector results. |
| **Live Stream Forensics** | Detects only near-white (>220) or near-black (<35) corner patches ≥12px | The heuristic is intentionally conservative to avoid false alarms on tactical feeds. Coloured/small triggers are not flagged. | Extend to multi-color corner heuristic; add model-grounded trigger probe for live frames. |
| **Distribution Shift** | Needs explicit baseline upload | Drift metrics (PSI, KS, Wasserstein) are real but meaningless without an operator-provided clean baseline. | Auto-compute baseline from first clean scan; persist and version baselines. |
| **PyTorch Runtime** | `UNAVAILABLE` for raw `.pth` without architecture | Security contract: `torch.load(weights_only=True)` only. Arbitrary code execution is disabled. | Bundle TorchScript export utility; document that `.pt`/`onnx` are preferred for assurance. |
| **Saliency Trigger Probe** | `UNAVAILABLE` by default | A 0.4%-of-frame static patch does not move a whole-scene detector's logit margin reliably. The code path exists but is off unless a probe adapter is supplied. | Fine-grid occlusion sized to patch, or classification head with per-patch logit deltas. |
| **Frontend Build** | `npm run build` passes; served via FastAPI static files | No separate Node.js runtime needed at deploy. | N/A — working as intended. |

---

## SIH26228 Defense Assurance Guarantee

TRUST-CV provides quantifiable, mathematical proof of trust for Computer Vision pipelines:

1. **Mathematical Tamper Evidence**: Any alteration to datasets, model weights, or inference outputs invalidates SHA-256 Merkle roots or ECDSA signatures.
2. **Deterministic Reproducibility**: Zero external stochastic dependencies; all hash and statistical functions yield identical results across executions.
3. **Defense-in-Depth**: Five independent detection layers ensure that attacks bypassing one layer are intercepted by upstream or downstream engines.
4. **Air-Gapped Readiness**: Fully functional in disconnected tactical environments without telemetry leakage or external socket bindings.
5. **Honest Unavailability**: Stages that cannot run without operator-provided context report `UNAVAILABLE` rather than fabricating results.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**Built for SIH26228 — Ministry of Defence, Government of India**  
**Zero-Trust CV Integrity Assurance — Air-Gapped, Cryptographic, Auditable**