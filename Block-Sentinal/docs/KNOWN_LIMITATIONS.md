# KNOWN LIMITATIONS — TRUST-CV

**SIH26228 — Zero-Trust Computer Vision Integrity Assurance**

This document records all known limitations of the TRUST-CV system as of
Phase 10. These are not bugs. They are the honest boundary of what the current
implementation can and cannot do.

Do not present capabilities beyond what is listed in the PASS column of
`FINAL_COMPLIANCE_AUDIT.md`.

---

## Data Integrity Limitations

### L-01: Trigger Candidate Detection is Heuristic

**What works:**
- **Static Repeated Patch Matching (`STATIC_PATCH`):**
  - Corner-patch patterns across ≥ 2 samples sharing the same label (confidence = `affected/group_size`).
  - **Sliding-window spatial grid scanner** checking all spatial regions (not just corners) using perceptual difference hashing (dHash) and variance filtering to identify recurring non-corner patches.
- **Proxy Model Occlusion Saliency (`HEURISTIC_SALIENCY_ANOMALY`):**
  - Lightweight occlusion sensitivity check over a proxy model grid to flag localized spatial regions exhibiting abnormally high predictive influence relative to the rest of the image (saliency ratio $\ge 3.0\times$ mean, $z \ge 2.2$, confidence = `0.50`).

**What does not work:**
- Imperceptible gradient-optimized perturbations (e.g., FGSM, PGD-crafted clean-label adversarial perturbations) that pass statistical checks without localized occlusion spikes.
- Full gradient-based trigger inversion or reconstruction (e.g., Neural Cleanse) which requires model backpropagation and GPU training runtimes outside air-gapped field constraints.
- Triggers that dynamically vary per sample or use adaptive physical blending.

**Crucial Assurance Boundary:**
While the sliding-window scanner and proxy occlusion sensitivity extend heuristic coverage beyond static corners to all spatial regions and localized predictive hotspots, **this still is not a guarantee against adversarially optimized triggers, just wider heuristic coverage**. It serves as an additional defensive heuristic layer. Findings are explicitly tagged by mechanism (`STATIC_PATCH` vs `HEURISTIC_SALIENCY_ANOMALY`) with distinct confidence metrics so analysts can calibrate forensic reviews appropriately.

**Impact:** Finding type is `TRIGGER_CANDIDATE`, explicitly not `TRIGGER_BACKDOOR`. Human review is required for any positive finding.

---

### L-02: OOD Detection Uses Two Features

**What works:** Per-sample Z-score OOD detection on brightness and entropy
against a provided reference distribution.

**What does not work:** Detection of OOD based on texture, frequency, shape,
semantic content, or any of the 12 other features tracked by
`ImageDistributionExtractor`.

**Why:** The `OODDetector` is a lightweight per-sample component. The 14-feature
distribution shift analysis is done at the batch level by `DistributionShiftEngine`,
not per sample.

**Impact:** Per-sample OOD sensitivity is limited. Batch-level distribution
shift (`DistributionShiftEngine`) is more comprehensive but requires a pre-registered
reference baseline.

---

### L-03: Label Conflict Detection Requires Visual Similarity

**What works:** Near-identical images (Hamming distance ≤ `distance_threshold`)
with different labels are flagged as `LABEL_INCONSISTENCY`.

**What does not work:** Systematic mislabeling across visually distinct images
(e.g., all images of class A labelled as class B when they look nothing like
each other).

**Why:** The detector relies on perceptual dHash proximity to identify
"similar" samples. Without visual similarity, there is no baseline for
detecting that a label is wrong.

**Impact:** Clean-label poisoning where identical content is labelled
differently is detectable; broad systematic misclassification is not.

---

### L-04: No Gradient-Based or Feature-Space Poisoning Detection

**What works:** Visual artifacts, structural anomalies, and statistical
outliers are detectable.

**What does not work:** Imperceptible adversarial perturbations (e.g., FGSM,
PGD-crafted clean-label attacks) that pass all pixel-level and statistical
checks.

**Why:** No gradient-based or embedding-space analysis is implemented.
Detection of clean-label poisoning without pixel-level artifacts requires
model-dependent analysis that is out of scope.

---

## Model Assurance Limitations

### L-05: Black-Box Models Cannot Be Structurally Verified

**What works:** Binary SHA-256 verification. Any byte change is detected.

**What does not work:** Architecture verification, weight-level analysis,
behavioral fingerprinting (probe battery falls back to weight-sensitive
synthetic forward for some formats).

**Why:** `AccessMode.BLACK_BOX` explicitly disables structural verification.
The system reports `structural_identity: UNAVAILABLE` and documents this in
`ModelAssuranceFinding.limitations`.

---

### L-06: PyTorch Models Cannot Execute in ONNX Runtime

**What works:** SHA-256, per-layer weight hashing, structural hash,
ECDSA-signed identity. Behavioral fingerprinting uses a weight-sensitive
deterministic forward pass.

**What does not work:** Live ONNX Runtime execution (inference DNA) for
`.pt`/`.pth` format. The PyTorch adapter raises
`PYTORCH_RUNTIME_UNAVAILABLE` when `predict()` is called — this is a
deliberate security contract (no arbitrary pickle execution).

**Why:** Executing a raw PyTorch state_dict requires the original model class
definition which may contain arbitrary Python code.

**Mitigation:** Convert models to ONNX format before submitting to the
inference assurance pipeline.

---

## Inference Assurance Limitations

### L-07: Replay Protection is Scoped to a Single Generator Instance

**What works:** Nonce and record ID replay detected within a single
`InferenceDNAGenerator` instance bound to a specific `storage_dir`.

**What does not work:** Cross-instance replay detection when the system is
deployed with a fresh generator pointing to a different storage directory.

**Why:** The `seen_nonces` and `seen_records` sets are persisted to
`storage_dir/state.json`. A new instance with a new path has empty sets.

**Mitigation:** Always use the same persistent `storage_dir` across
restarts. The default path `DATA_DIR/inference_dna/` ensures persistence
within a single deployment.

---

## Distribution Shift Limitations

### L-08: Baseline Must Be Independently Registered

**What works:** Shift detection against a pre-registered, independently
sourced, ECDSA-signed reference baseline.

**What does not work:** Shift detection without a baseline — produces
UNAVAILABLE, never a silent PASS.

**Why:** This is an intentional invariant. Self-comparison (using the
candidate batch as its own baseline) would always produce zero drift and
is explicitly prohibited by the `baseline_id != target_batch_id` check.

**Impact:** A baseline must be registered via `POST /api/v1/drift/baseline`
before any shift analysis can run. The demo requires this step.

---

### L-09: Statistical Power Is Reduced at Small Batch Sizes

**What works:** KS distance, PSI, Wasserstein, and energy distance
calculations on any batch size ≥ 1.

**What does not work:** Reliable statistical inference at very small batch
sizes (< 10 samples). KS distance is exact but PSI requires sufficient
bin occupancy.

---

## Ledger Limitations

### L-10: Unsigned System Events Can Be Consistently Rewritten

**What works:** Any modification to a committed event's fields or hash chain
links is detected by `verify_chain()`.

**What does not work:** A compromised system that can recalculate all
downstream hashes consistently can rewrite unsigned events without detection.
System events (`ingestion`, `finding`, `scan_start`, etc.) are not ECDSA-signed.

**What is protected by ECDSA:** Analyst decisions
(`record_analyst_decision(..., sign=True)`) are ECDSA-signed and cannot be
silently rewritten.

**Mitigation:** For deployment requiring stronger guarantees, sign all
events at append time. The `LedgerEngine.append_event(..., sign=True)`
parameter supports this.

---

### L-11: Ledger Is In-Memory During a Scan

**What works:** Events are committed to SQLite after each stage.

**What does not work:** If the backend process crashes mid-pipeline, ledger
events for completed stages may or may not be persisted depending on the crash
point.

---

## Frontend / UX Limitations

### L-12: Scan Session Lost on Browser Refresh

**What works:** Active scan continues on the backend. Results are fully
recoverable if the `scan_id` is known.

**What does not work:** The browser loses `currentScanId` on page refresh.
There is no `sessionStorage` persistence implemented.

**Impact:** If a user refreshes during a scan, they must re-upload the dataset.
The backend scan result can still be retrieved directly via
`GET /api/v1/scan/{scan_id}` if the ID is recorded.

---

### L-13: LiveMetrics and TerminalLog Are Not Streamed

**What works:** Final counts and findings appear on the results page after
scan completion.

**What does not work:** Incremental counter updates (samples analyzed,
duplicates found) during scanning. The backend does not push partial results
during execution.

**Impact:** The LiveMetrics and TerminalLog components remain at zero/empty
during the scan and populate only from the final assessment.

---

### L-14: Inference and Manifest Artifact Slots Are Local-Only

**What works:** The Dataset (upload → scan) and Model (upload → registry)
artifact slots in the browser UI call real backend endpoints.

**What does not work:** The Inference Output and Manifest/Signature artifact
slots in the UI accept files locally (for display) but do not POST to any
backend endpoint.

**Impact:** Inference provenance analysis in the scan pipeline still works
when a model is registered in the backend registry and inference is
executed via the backend `POST /api/v1/inference/run` endpoint.

---

### L-16: Low-Contrast and Blended Triggers (Subtle Perturbations)

**What works:** High-contrast static localized patches, solid color blocks (black/white 8x8), checkerboards, diagonal stripes, and bright dot triggers.

**What does not work:** Low-contrast, subtle blended watermarks, or imperceptible sinusoidal triggers where pixel variance and horizontal gradient differences fall below perceptual detection thresholds (`variance < 80.0` or dHash difference < 6 bits).

**Why:** Backdoor detection thresholds are deliberately calibrated to differentiate attack triggers from natural smooth gradients, low-contrast sensor noise, and uniform terrain backgrounds to maintain zero false positives.

---

### L-17: Tiled, Distributed, and Global Triggers (Non-Localized)

**What works:** Localized spatial triggers in corner regions and interior sliding windows constrained by spatial co-location (`span <= 24px`).

**What does not work:** Spatially dispersed or global triggers, such as sparse pixels scattered across distant quadrants, periodic grid watermarks, or full-frame steganographic noise.

**Why:** The sliding-window perceptual hash scanner requires spatial locality across matching samples to avoid conflating natural repeating image features (e.g. horizontal horizon lines, vertical structures, periodic scanlines) with adversarial triggers.

---

### L-18: Detection Thresholds Tuned on Synthetic Datasets

**What works:** High recall across synthetic red-team triggers, BadNets benchmarks, and multi-spectral Earth Observation datasets (e.g. BigEarthNet-S2) with zero false positives.

**What does not work:** Extreme high-dynamic-range (HDR) raw 16-bit sensor feeds with unconventional noise profiles or non-standard quantization may require threshold recalibration (specifically bimodal variance `variance >= 6000.0` and tail ratio thresholds).

**Why:** Detector thresholds were empirically validated against synthetic attack batteries and standardized 8-bit / normalized EO sensor baselines to achieve defense-grade balance between recall and false-alarm suppression.

---

## Coverage Limitation

### L-15: Approximately 36% of Mapped Attack Vectors Are Not Covered

The Phase 9 attack coverage analysis mapped 50 attack vectors across 6 domains.
32 are covered (~64%), 5 are partially covered, and 13 have no current detector.

Uncovered categories include:
- Gradient-based adversarial examples
- Semantic OOD (content shift without pixel statistics change)
- Cross-batch coordinated attack correlation
- Contributor identity forgery (no cryptographic binding)
- Complete hash-chain rewrite (for unsigned system events)

See `ATTACK_COVERAGE.md` for the full breakdown.

---

## Summary Table

| # | Limitation | Category | Severity |
|---|-----------|----------|----------|
| L-01 | Trigger detection heuristic (corner only) | Data Integrity | MEDIUM |
| L-02 | OOD detection uses 2 features only | Data Integrity | MEDIUM |
| L-03 | Label conflict requires visual similarity | Data Integrity | LOW |
| L-04 | No gradient/embedding-space poisoning detection | Data Integrity | HIGH |
| L-05 | Black-box model unverifiable structurally | Model Assurance | MEDIUM |
| L-06 | PyTorch models cannot use ONNX runtime | Model Assurance | LOW |
| L-07 | Replay protection scoped to single instance | Inference | LOW |
| L-08 | Baseline must be pre-registered | Drift | LOW |
| L-09 | Reduced statistical power at small batches | Drift | LOW |
| L-10 | Unsigned system events rewritable consistently | Ledger | MEDIUM |
| L-11 | Mid-crash event persistence not guaranteed | Ledger | LOW |
| L-12 | Browser refresh loses scan session | Frontend | LOW |
| L-13 | LiveMetrics/TerminalLog not streamed | Frontend | LOW |
| L-14 | Inference/Manifest artifact slots local-only | Frontend | LOW |
| L-15 | ~36% attack vector coverage gap | Overall | HIGH |
| L-16 | Low-contrast / blended triggers undetectable | Data Integrity | MEDIUM |
| L-17 | Non-localized / distributed triggers missed | Data Integrity | MEDIUM |
| L-18 | Thresholds tuned on synthetic / 8-bit baselines | Data Integrity | LOW |

---

*Document generated from Phase 10 audit — September 2026.*
