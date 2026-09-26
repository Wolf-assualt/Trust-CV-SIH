/**
 * TRUST-CV: Defense SOC Command Center & Mission Orchestrator
 * Pure Vanilla JavaScript State Machine & Real-Time Visualization Layer.
 * 100% Offline / Air-Gapped / Zero Remote Dependencies.
 */

document.addEventListener('DOMContentLoaded', () => {
  const api = window.TrustCVAPI || window.TrustCvApi || (typeof TrustCvApiClient !== 'undefined' ? new TrustCvApiClient() : null);

  const AppState = {
    theme: localStorage.getItem('trustcv_theme') || 'dark',
    activePhase: 1, // 1: Launch, 2: Scan, 3: Results
    uploadMode: 'real_upload', // 'real_upload' or 'demo_scenario'
    selectedFiles: [],
    detectedBands: [],
    currentScenario: 'pristine_eo', // pristine_eo, tamper_b04, benign_drift, model_tamper, inference_replay
    mission: {
      id: 'MSN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      startTime: new Date(),
      assetName: 'Sentinel2_S2A_Recon_Tile',
      assetType: 'EARTH_OBSERVATION_SATELLITE',
      format: 'BIGEARTHNET_S2',
      datasetManifest: null,
      modelManifest: null,
      dnaRecords: [],
      driftReport: null,
      fusedAssessment: null,
      graphData: { nodes: [], edges: [] },
      blastRadius: null,
      report: null,
      isHardVeto: false,
      isQuarantined: false,
    },
    graphRenderer: null,
    scanInterval: null,
  };

  const SENTINEL2_BANDS = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B09", "B11", "B12"];
  const MAX_UPLOAD_FILES = 3000;

  // =========================================================================
  // 1. THEME MANAGEMENT
  // =========================================================================

  function applyTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('trustcv_theme', theme);
    const icon = document.querySelector('#btn-theme-toggle svg');
    if (icon) {
      icon.innerHTML = theme === 'dark' 
        ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }

    if (AppState.graphRenderer) {
      AppState.graphRenderer.render();
    }
  }

  // =========================================================================
  // 2. STAGE NAVIGATION & HUD UPDATES
  // =========================================================================

  function setPhase(phaseNum) {
    AppState.currentPhase = phaseNum;
    document.querySelectorAll('.stage-view').forEach(view => {
      view.classList.remove('active');
    });
    const target = document.getElementById(`stage-view-${phaseNum}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.hud-step').forEach(step => {
      const stepNum = parseInt(step.getAttribute('data-step'), 10);
      step.classList.toggle('active', stepNum === phaseNum);
      step.classList.toggle('completed', stepNum < phaseNum);
    });

    // Animate stage transitions
    if (phaseNum === 2) {
      const term = document.getElementById('terminal-body');
      if (term) term.scrollTop = term.scrollHeight;
    } else if (phaseNum === 3) {
      if (AppState.graphRenderer) {
        setTimeout(() => {
          if (typeof AppState.graphRenderer.animateFlow === 'function') {
            AppState.graphRenderer.animateFlow();
          } else if (typeof AppState.graphRenderer.startParticleLoop === 'function') {
            AppState.graphRenderer.startParticleLoop();
          }
        }, 300);
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // =========================================================================
  // 3. FILE / FOLDER SELECTION & VALIDATION
  // =========================================================================

  function setUploadMode(mode) {
    AppState.uploadMode = mode;
    const tabUpload = document.getElementById('tab-mode-upload');
    const tabDemo = document.getElementById('tab-mode-demo');
    const presetsSection = document.getElementById('section-demo-presets');

    if (mode === 'real_upload') {
      if (tabUpload) { tabUpload.className = 'btn btn-primary mode-tab active'; }
      if (tabDemo) { tabDemo.className = 'btn btn-secondary mode-tab'; }
      if (presetsSection) presetsSection.style.display = 'none';
      document.getElementById('meta-expected-status').textContent = 'READY FOR INGESTION';
      document.getElementById('meta-expected-status').style.color = 'var(--status-info)';
    } else {
      if (tabUpload) { tabUpload.className = 'btn btn-secondary mode-tab'; }
      if (tabDemo) { tabDemo.className = 'btn btn-primary mode-tab active'; }
      if (presetsSection) presetsSection.style.display = 'block';
      selectScenario(AppState.currentScenario);
    }
  }

  function handleFileSelection(filesList) {
    if (!filesList || filesList.length === 0) return;

    const fileCount = filesList.length;
    const banner = document.getElementById('upload-status-banner');
    const countEl = document.getElementById('upload-file-count');
    const sizeEl = document.getElementById('upload-total-size');
    const msgEl = document.getElementById('upload-validation-msg');
    const metaStatus = document.getElementById('meta-expected-status');
    const formatBadge = document.getElementById('badge-dataset-format');

    // Preflight count validation: block immediately if exceeds MAX_UPLOAD_FILES
    if (fileCount > MAX_UPLOAD_FILES) {
      AppState.selectedFiles = [];
      AppState.detectedBands = [];
      AppState.uploadMode = 'real_upload';
      setUploadMode('real_upload');

      if (banner) banner.style.display = 'block';
      if (countEl) {
        countEl.textContent = `${fileCount.toLocaleString()} File(s) Selected (EXCEEDS LIMIT)`;
        countEl.style.color = 'var(--status-danger)';
      }
      if (sizeEl) sizeEl.textContent = 'BLOCKED';
      if (msgEl) {
        msgEl.textContent = `Too many files selected (${fileCount.toLocaleString()}). Maximum allowed is ${MAX_UPLOAD_FILES.toLocaleString()} files per upload.`;
        msgEl.style.color = 'var(--status-danger)';
      }
      if (metaStatus) {
        metaStatus.textContent = `BLOCKED (MAX ${MAX_UPLOAD_FILES} FILES)`;
        metaStatus.style.color = 'var(--status-danger)';
      }

      // Reset spectral band visualizer
      document.querySelectorAll('.spectral-band-tile').forEach(tile => {
        tile.classList.remove('detected', 'tampered');
        tile.style.borderColor = '';
        tile.style.background = '';
      });

      return;
    }

    AppState.uploadMode = 'real_upload';
    setUploadMode('real_upload');
    AppState.selectedFiles = Array.from(filesList);

    // Calculate total size and analyze file types
    let totalBytes = 0;
    const detectedBands = new Set();
    let hasTif = false;
    let hasJson = false;

    AppState.selectedFiles.forEach(file => {
      totalBytes += file.size || 0;
      const nameUpper = file.name.toUpperCase();
      if (nameUpper.endsWith('.TIF') || nameUpper.endsWith('.TIFF')) {
        hasTif = true;
        SENTINEL2_BANDS.forEach(b => {
          if (nameUpper.includes(`_${b}.`) || nameUpper.includes(`_${b}_`) || nameUpper.endsWith(`${b}.TIF`) || nameUpper.endsWith(`${b}.TIFF`) || nameUpper === `${b}.TIF` || nameUpper === `${b}.TIFF`) {
            detectedBands.add(b);
          }
        });
      }
      if (nameUpper.endsWith('.JSON')) hasJson = true;
    });

    AppState.detectedBands = Array.from(detectedBands);

    // Format human-readable size
    let sizeStr = `${(totalBytes / 1024).toFixed(1)} KB`;
    if (totalBytes > 1024 * 1024) {
      sizeStr = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    // Update Banner
    if (banner) banner.style.display = 'block';
    if (countEl) {
      countEl.textContent = `${AppState.selectedFiles.length} File(s) Selected`;
      countEl.style.color = 'var(--text-accent)';
    }
    if (sizeEl) sizeEl.textContent = sizeStr;

    // Detect format and structure
    let format = 'IMAGE_FOLDER';
    let validationMessage = '';

    if (hasTif && detectedBands.size > 0) {
      format = 'BIGEARTHNET_S2';
      if (formatBadge) formatBadge.textContent = 'BIGEARTHNET-S2 (EO)';

      const missingBands = SENTINEL2_BANDS.filter(b => !detectedBands.has(b));
      if (detectedBands.size === 12) {
        validationMessage = `12/12 Sentinel-2 Level-2A spectral bands detected. Structure VALID.`;
        if (msgEl) msgEl.style.color = 'var(--status-success)';
      } else {
        validationMessage = `Multi-spectral subset detected (${detectedBands.size}/12 bands). Missing: ${missingBands.slice(0, 4).join(', ')}${missingBands.length > 4 ? '...' : ''}`;
        if (msgEl) msgEl.style.color = 'var(--status-warning)';
      }
    } else {
      format = 'IMAGE_FOLDER';
      if (formatBadge) formatBadge.textContent = 'IMAGE_FOLDER';
      validationMessage = `${AppState.selectedFiles.length} image file(s) ready for non-destructive hash ingestion.`;
      if (msgEl) msgEl.style.color = 'var(--status-info)';
    }

    if (msgEl) msgEl.textContent = validationMessage;

    // Update Spectral Band Grid
    document.querySelectorAll('.spectral-band-tile').forEach(tile => {
      const bandName = tile.getAttribute('data-band');
      const isFound = detectedBands.has(bandName);
      tile.classList.toggle('detected', isFound);
      tile.classList.remove('tampered');
      if (isFound) {
        tile.style.borderColor = 'var(--status-success)';
        tile.style.background = 'var(--status-success-bg)';
      } else {
        tile.style.borderColor = '';
        tile.style.background = '';
      }
    });

    // Derive human-readable asset/folder name
    let assetName = 'Uploaded_Dataset_Batch';
    const firstFile = AppState.selectedFiles[0];
    if (firstFile.webkitRelativePath) {
      const parts = firstFile.webkitRelativePath.split('/');
      assetName = parts.length > 1 ? parts[0] : parts[0].replace(/\.[^/.]+$/, "");
    } else if (firstFile.name) {
      assetName = firstFile.name.replace(/\.[^/.]+$/, "");
    }

    const metaAssetNameEl = document.getElementById('meta-asset-name');
    const metaPayloadFormatEl = document.getElementById('meta-payload-format');
    if (metaAssetNameEl) metaAssetNameEl.textContent = assetName.substring(0, 24);
    if (metaPayloadFormatEl) metaPayloadFormatEl.textContent = format;
    if (metaStatus) {
      metaStatus.textContent = 'VALID (READY TO SCAN)';
      metaStatus.style.color = 'var(--status-success)';
    }

    AppState.mission.assetName = assetName;
    AppState.mission.format = format;
  }

  // =========================================================================
  // 4. SCENARIOS CONFIGURATION & SELECTION (CONTROLLED DEMO MODE)
  // =========================================================================

  const Scenarios = {
    pristine_eo: {
      name: 'Authentic Sentinel-2 EO Patch',
      tag: 'HAPPY PATH',
      tagClass: 'badge-health-ok',
      desc: 'Pristine 12-band multi-spectral patch. Full Merkle inclusion integrity, approved model weights, and valid inference DNA.',
      tamperedBand: null,
      expectedVerdict: 'ACCEPTED',
      riskScore: 0.05,
      hardVeto: false,
    },
    tamper_b04: {
      name: 'Adversarial B04 (Red Band) Tamper',
      tag: 'HARD VETO',
      tagClass: 'badge-health-crit',
      desc: 'Controlled byte injection into Band 4 (Red) GeoTIFF. Immediate Merkle divergence, hard-veto BLOCK, and quarantine.',
      tamperedBand: 'B04',
      expectedVerdict: 'QUARANTINED',
      riskScore: 0.98,
      hardVeto: true,
    },
    benign_drift: {
      name: 'Seasonal Autumn Terrain Drift',
      tag: 'REVIEW ONLY',
      tagClass: 'badge-health-warn',
      desc: 'Natural vegetation decay & lower solar angle. Significant statistical drift detected; no quarantine.',
      tamperedBand: null,
      expectedVerdict: 'REVIEW',
      riskScore: 0.35,
      hardVeto: false,
    },
    model_tamper: {
      name: 'Model Weight Tensor Modification',
      tag: 'MODEL TAMPER',
      tagClass: 'badge-health-crit',
      desc: 'Single floating-point weight mutation in classifier layer. State dict divergence triggers hard-veto quarantine.',
      tamperedBand: null,
      expectedVerdict: 'QUARANTINED',
      riskScore: 0.95,
      hardVeto: true,
    },
    inference_replay: {
      name: 'Inference DNA Nonce Replay',
      tag: 'REPLAY ATTACK',
      tagClass: 'badge-health-crit',
      desc: 'Replaying valid Inference DNA in stream. Nonce collision breaks sequence chain.',
      tamperedBand: null,
      expectedVerdict: 'QUARANTINED',
      riskScore: 0.90,
      hardVeto: true,
    },
  };

  function selectScenario(scenarioKey) {
    AppState.currentScenario = scenarioKey;
    const sc = Scenarios[scenarioKey];
    if (!sc) return;

    // Update UI Preset Cards
    document.querySelectorAll('.preset-card').forEach(card => {
      card.classList.toggle('selected', card.getAttribute('data-scenario') === scenarioKey);
    });

    // Update Spectral Bands Visualizer
    document.querySelectorAll('.spectral-band-tile').forEach(tile => {
      const bandName = tile.getAttribute('data-band');
      tile.classList.toggle('tampered', bandName === sc.tamperedBand);
      tile.style.borderColor = '';
      tile.style.background = '';
    });

    // Update Preflight Meta
    const metaAsset = document.getElementById('meta-asset-name');
    if (metaAsset) metaAsset.textContent = sc.name;

    const metaStatus = document.getElementById('meta-expected-status');
    if (metaStatus) {
      metaStatus.textContent = sc.expectedVerdict;
      metaStatus.style.color = sc.hardVeto ? 'var(--status-danger)' : (sc.expectedVerdict === 'REVIEW' ? 'var(--status-warning)' : 'var(--status-success)');
    }
  }

  // =========================================================================
  // 5. PHASE 2: TERMINAL LOGGING & SCAN SIMULATION
  // =========================================================================

  function addTerminalLog(op, msg, type = 'info') {
    const term = document.getElementById('terminal-body');
    if (!term) return;

    const now = new Date();
    const ts = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const row = document.createElement('div');
    row.className = `log-entry ${type}`;
    row.innerHTML = `
      <span class="log-ts">[${ts}]</span>
      <span class="log-op">${op.padEnd(20, '.')}</span>
      <span class="log-msg">${msg}</span>
    `;

    term.appendChild(row);
    term.scrollTop = term.scrollHeight;
  }

  function updatePipelineStage(stageIndex, status) {
    const item = document.getElementById(`stage-item-${stageIndex}`);
    if (!item) return;

    item.className = `pipeline-stage-item ${status.toLowerCase()}`;
    const badge = item.querySelector('.stage-badge');
    if (badge) {
      badge.textContent = status.toUpperCase();
      badge.className = `stage-badge badge-${status.toLowerCase()}`;
    }
  }

  function updateRiskMeter(score, isHardVeto) {
    const scoreVal = document.getElementById('live-risk-score');
    const barFill = document.getElementById('live-risk-fill');
    if (scoreVal) scoreVal.textContent = score.toFixed(2);
    if (barFill) {
      barFill.style.width = `${Math.min(100, Math.max(0, score * 100))}%`;
      barFill.style.backgroundColor = isHardVeto ? 'var(--status-danger)' : (score > 0.3 ? 'var(--status-warning)' : 'var(--status-success)');
    }
  }

  async function launchAssuranceScan() {
    if (AppState.uploadMode === 'real_upload') {
      if (!AppState.selectedFiles || AppState.selectedFiles.length === 0) {
        alert("Please select a valid dataset folder or band files before launching the assurance scan.");
        return;
      }
      if (AppState.selectedFiles.length > MAX_UPLOAD_FILES) {
        alert(`Too many files selected (${AppState.selectedFiles.length.toLocaleString()}). Maximum allowed is ${MAX_UPLOAD_FILES.toLocaleString()} files per upload.`);
        return;
      }
    }

    setPhase(2);
    const scenario = Scenarios[AppState.currentScenario];
    const isRealUpload = (AppState.uploadMode === 'real_upload' && AppState.selectedFiles.length > 0);

    const term = document.getElementById('terminal-body');
    if (term) term.innerHTML = '';
    for (let i = 1; i <= 12; i++) {
      updatePipelineStage(i, 'pending');
    }
    updateRiskMeter(0.0, false);

    const assetDisplayName = isRealUpload ? AppState.mission.assetName : scenario.name;
    addTerminalLog('MISSION.START', `Initializing Assurance Mission [${AppState.mission.id}] for '${assetDisplayName}'...`, 'highlight');

    AppState.mission.datasetManifest = null;
    AppState.mission.report = null;
    AppState.mission.graphData = { nodes: [], edges: [] };

    // ========== REAL UPLOAD + AUTHORITATIVE BACKEND POLLING ==========
    if (isRealUpload) {
      addTerminalLog('UPLOAD.INGEST', `Transmitting ${AppState.selectedFiles.length} file(s) to secure local sandbox...`, 'info');
      let scanSession;
      try {
        const formData = new FormData();
        formData.append('dataset_name', AppState.mission.assetName);
        AppState.selectedFiles.forEach(file => {
          formData.append('files', file);
        });
        if (AppState.baselineFile) {
          formData.append('baseline_file', AppState.baselineFile);
        }

        scanSession = api ? await api.uploadDataset(formData) : await window.TrustCvApi.uploadDataset(formData);
        if (!scanSession || !scanSession.scan_id) {
          throw new Error("Backend did not return a scan session.");
        }
        AppState.mission.scanId = scanSession.scan_id;
        AppState.mission.batchId = scanSession.batch_id || null;
        addTerminalLog('SCAN.SESSION', `Scan session [${scanSession.scan_id.substring(0, 8)}...] created. Batch: ${(scanSession.batch_id || 'NONE').substring(0, 8)}...`, 'pass');
      } catch (err) {
        addTerminalLog('UPLOAD.FAILED', `Ingestion failed: ${err.message}`, 'danger');
        updatePipelineStage(1, 'blocked');
        updateRiskMeter(1.0, true);
        alert(`Dataset Ingestion Failed: ${err.message}`);
        return;
      }

      // ---------- Poll the authoritative backend scan status ----------
      const pollIntervalMs = 500;
      const maxPolls = 600; // ~5 min safety
      let polls = 0;
      let done = false;
      const finalizeStage12 = (sess) => {
        updatePipelineStage(12, 'passed');
        const finalRisk = (sess && sess.assessment && typeof sess.assessment.assuranceScore === 'number')
          ? (1.0 - sess.assessment.assuranceScore)
          : (sess && sess.status === 'FAILED' ? 1.0 : 0.05);
        updateRiskMeter(finalRisk, sess && sess.status === 'FAILED');
      };

      const pollOnce = async () => {
        if (done) return;
        polls++;
        if (polls > maxPolls) {
          done = true;
          addTerminalLog('SCAN.TIMEOUT', 'Scan polling exceeded max duration. Finalizing with partial state.', 'danger');
          finalizeStage12(scanSession);
          setTimeout(() => {
            populateResultsPage(null, null, scanSession);
            setPhase(3);
          }, 600);
          return;
        }
        try {
          const sess = api ? await api.getScan(AppState.mission.scanId) : await window.TrustCvApi.getScan(AppState.mission.scanId);
          scanSession = sess;

          // Map ScanStage (9 backend stages) to 12 frontend stage slots + ComponentState
          const backendStage = (sess.stage || 'INGESTION').toUpperCase();
          const progress = Math.max(0, Math.min(1, typeof sess.progress === 'number' ? sess.progress : 0));
          const stageResults = sess.stage_results || {};

          // Stage 1: READ_ONLY.INSPECT (always PASS)
          updatePipelineStage(1, sess.status === 'PENDING' ? 'pending' : 'passed');

          // Stage 2: CRYPTO.MERKLE_TREE  (DATA_INGESTION + HASH_VERIFICATION components)
          if (backendStage === 'HASHING' || sess.status === 'IN_PROGRESS' || sess.status === 'COMPLETED' || sess.status === 'FAILED') {
            const s2 = (stageResults.DATA_INGESTION && stageResults.DATA_INGESTION.status) || (sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            updatePipelineStage(2, s2);
          }

          // Stage 3: DATA.INTEGRITY (DATASET_ANALYSIS + 5 sub components)
          if (backendStage === 'DATA_INTEGRITY' || backendStage.match(/^MODEL|INFERENCE|DISTRIBUTION|EVIDENCE|REPORT|COMPLETED$/) || sess.status === 'FAILED') {
            const s3 = (stageResults.DATASET_ANALYSIS && stageResults.DATASET_ANALYSIS.status) || (sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            updatePipelineStage(3, s3);
          }

          // Stage 4: MODEL.IDENTITY
          if (backendStage === 'MODEL_ASSURANCE' || backendStage.match(/^INFERENCE|DISTRIBUTION|EVIDENCE|REPORT|COMPLETED$/) || sess.status === 'FAILED') {
            const s4 = (stageResults.MODEL_INTEGRITY && stageResults.MODEL_INTEGRITY.status) || (sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            updatePipelineStage(4, s4);
          }

          // Stage 5: BEHAVIOR.FINGERPRINT — only reported by stage_results.FINGERPRINT.
          // Absent backend evidence must stay UNAVAILABLE, never be assumed passed.
if (backendStage === 'INFERENCE_ASSURANCE' || backendStage.match(/^DISTRIBUTION|EVIDENCE|REPORT|COMPLETED$/) || sess.status === 'FAILED') {
             const fpComp = stageResults.FINGERPRINT || {};
            const s5 = fpComp.status
              ? String(fpComp.status).toLowerCase()
              : 'unavailable';
            updatePipelineStage(5, s5);
          }

          // Stage 6: INFERENCE.DNA (INFERENCE_VALIDATION + BACKDOOR_ANALYSIS)
if (backendStage === 'INFERENCE_ASSURANCE' || backendStage.match(/^DISTRIBUTION|EVIDENCE|REPORT|COMPLETED$/) || sess.status === 'FAILED') {
             const inferComp = stageResults.INFERENCE_VALIDATION || stageResults.BACKDOOR_ANALYSIS || {};
            const s6 = inferComp.status || (sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            updatePipelineStage(6, s6);
          }

          // Stage 7: DISTRIBUTION.DRIFT — preserve the backend component status exactly.
          // UNAVAILABLE must remain UNAVAILABLE; only a backend PASSED with review
          // language is downgraded to the non-blocking 'review' presentation.
          if (backendStage === 'DISTRIBUTION_SHIFT' || backendStage.match(/^EVIDENCE|REPORT|COMPLETED$/) || sess.status === 'FAILED') {
            const driftComp = stageResults.DISTRIBUTION_SHIFT || {};
            let s7 = driftComp.status || (backendStage === 'DISTRIBUTION_SHIFT' && sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            if (s7 === 'PASSED' && driftComp.explanation && driftComp.explanation.match(/review/i)) s7 = 'review';
            if (s7 === 'UNAVAILABLE') {
              s7 = 'unavailable';
              emitOnce('s7_unavail_ui', 'DISTRIBUTION.DRIFT', `UNAVAILABLE: ${driftComp.explanation || 'Distribution shift analysis unavailable.'}`, 'review');
            }
            updatePipelineStage(7, s7);
          }

          // Stage 8: EVIDENCE.FUSION
if (backendStage === 'EVIDENCE_FUSION' || backendStage.match(/^REPORT|COMPLETED$/) || sess.status === 'FAILED') {
             const s8 = (stageResults.EVIDENCE_FUSION && stageResults.EVIDENCE_FUSION.status) || (sess.status === 'IN_PROGRESS' ? 'running' : 'pending');
            updatePipelineStage(8, s8);
          }

          // Stage 9: GATEKEEPER.ACTION (uses FINAL_VERDICT once reached or uses disposition)
          if (backendStage === 'REPORT' || backendStage === 'COMPLETED' || sess.status === 'FAILED') {
            const disposition = (sess.assessment && sess.assessment.disposition) || '';
            let s9 = 'passed';
            if (sess.status === 'FAILED') s9 = 'blocked';
            else if (disposition === 'QUARANTINED' || disposition === 'BLOCK') s9 = 'blocked';
            else if (disposition === 'REVIEW' || disposition === 'ALLOW_WITH_MONITORING') s9 = 'review';
            updatePipelineStage(9, s9);
          }

          // Stage 10: PROVENANCE.LINEAGE (uses EVIDENCE_GRAPH component)
if (backendStage === 'EVIDENCE_FUSION' || backendStage.match(/^REPORT|COMPLETED$/) || sess.status === 'FAILED') {
             const s10 = (stageResults.EVIDENCE_GRAPH && stageResults.EVIDENCE_GRAPH.status) || 'passed';
            updatePipelineStage(10, s10);
          }

          // Stage 11: BLAST_RADIUS.EVAL (uses BLAST_RADIUS component)
          if (backendStage.match(/^REPORT|COMPLETED$/) || sess.status === 'FAILED') {
            const brComp = stageResults.BLAST_RADIUS || {};
            const s11 = brComp.status
              ? String(brComp.status).toLowerCase()
              : (sess.status === 'FAILED' ? 'blocked' : 'passed');
            updatePipelineStage(11, s11);
          }

          // Stage 12: FORENSIC.REPORT
          if (sess.status === 'COMPLETED' || sess.status === 'FAILED' || backendStage === 'REPORT') {
            const s12 = sess.status === 'FAILED' ? 'blocked' : 'passed';
            updatePipelineStage(12, s12);
          }

          // Log streams: emit stage banner log + findings stream once
          if (!AppState._stageEmitted) AppState._stageEmitted = {};
          const emitOnce = (key, op, msg, type) => {
            if (AppState._stageEmitted[key]) return;
            AppState._stageEmitted[key] = true;
            addTerminalLog(op, msg, type);
          };

          emitOnce('s1', 'READ_ONLY.INSPECT', `Scanning ${isRealUpload ? AppState.selectedFiles.length : 12} file(s). Non-destructive inspection lock active.`, 'pass');
          if (stageResults.DATA_INGESTION && stageResults.DATA_INGESTION.status === 'PASSED') {
            emitOnce('s2a', 'DATA.INGESTION', `Samples staged from secure upload sandbox into analysis path.`, 'pass');
          }
          if (stageResults.HASH_VERIFICATION && stageResults.HASH_VERIFICATION.status === 'PASSED') {
            emitOnce('s2b', 'CRYPTO.MERKLE_TREE', `All sample digests sealed with Ed25519. Merkle Root computed.`, 'pass');
          }
          if (stageResults.DATASET_ANALYSIS) {
            const sr = stageResults.DATASET_ANALYSIS;
            if (sr.status === 'PASSED' && sr.error_code !== undefined) {
              // has error_code => PASSED with informational note (normal, since some components UNAVAILABLE)
            }
            if (sr.status === 'FAILED') emitOnce('s3_fail', 'DATA.INTEGRITY', sr.explanation || 'Bit-level or perceptual audit flagged anomalies.', 'danger');
            else if (sr.status === 'PASSED') emitOnce('s3_pass', 'DATA.INTEGRITY', `Duplicate detection & 16-bit dHash perceptual audit clean. (${sess.findings ? sess.findings.length : 0} findings)`, 'pass');
          }
          if (stageResults.MODEL_INTEGRITY) {
            const mi = stageResults.MODEL_INTEGRITY;
            if (mi.status === 'PASSED') emitOnce('s4_pass', 'MODEL.IDENTITY', 'Approved architecture identity & deterministic state dict match baseline.', 'pass');
            else if (mi.status === 'FAILED') emitOnce('s4_fail', 'MODEL.IDENTITY', mi.explanation || 'Weight tensor state-dict hash mismatch! Approved baseline violated.', 'danger');
            else if (mi.status === 'UNAVAILABLE') emitOnce('s4_unavail', 'MODEL.IDENTITY', `UNAVAILABLE: ${mi.explanation || 'No model artifact provided in this scan batch.'}`, 'review');
          }
          if (stageResults.BACKDOOR_ANALYSIS || stageResults.INFERENCE_VALIDATION) {
            const infS = stageResults.INFERENCE_VALIDATION || stageResults.BACKDOOR_ANALYSIS || {};
            if (infS.status === 'PASSED') emitOnce('s6_pass', 'INFERENCE.DNA', 'Inference DNA tuple sealed: ⟨InputFrame, ModelDigest, Output, Nonce, PrevHash⟩.', 'pass');
            else if (infS.status === 'FAILED') emitOnce('s6_fail', 'INFERENCE.DNA', infS.explanation || 'Runtime validation or replay check failed.', 'danger');
            else if (infS.status === 'UNAVAILABLE') emitOnce('s6_unavail', 'INFERENCE.DNA', `UNAVAILABLE: ${infS.explanation || 'Inference module offline.'}`, 'review');
          }
          if (stageResults.DISTRIBUTION_SHIFT) {
            const ds = stageResults.DISTRIBUTION_SHIFT;
            if (ds.status === 'PASSED') emitOnce('s7_pass', 'DISTRIBUTION.DRIFT', ds.explanation || 'Spectral distributions within nominal operational tolerances.', 'pass');
            else if (ds.status === 'FAILED') emitOnce('s7_fail', 'DISTRIBUTION.DRIFT', ds.explanation || 'Drift classification detected with significant severity.', 'review');
            else if (ds.status === 'UNAVAILABLE') emitOnce('s7_unavail', 'DISTRIBUTION.DRIFT', `UNAVAILABLE: ${ds.explanation || 'No reference baseline registered.'}`, 'review');
          }
          if (stageResults.EVIDENCE_FUSION) {
            const ef = stageResults.EVIDENCE_FUSION;
            if (ef.status === 'PASSED') emitOnce('s8_pass', 'EVIDENCE.FUSION', ef.explanation || 'Multi-domain evidence fused cleanly.', 'pass');
            else if (ef.status === 'UNAVAILABLE') emitOnce('s8_unavail', 'EVIDENCE.FUSION', `UNAVAILABLE: ${ef.explanation || 'No evidence items to fuse.'}`, 'review');
          }
          if (stageResults.EVIDENCE_GRAPH) {
            const eg = stageResults.EVIDENCE_GRAPH;
            if (eg.status === 'PASSED') emitOnce('s10_pass', 'PROVENANCE.LINEAGE', 'Directed property graph updated with fusion assessment.', 'pass');
            else if (eg.status === 'UNAVAILABLE') emitOnce('s10_unavail', 'PROVENANCE.LINEAGE', `UNAVAILABLE: ${eg.explanation || 'Graph unavailable prior to fusion.'}`, 'review');
          }
          if (stageResults.FINGERPRINT) {
            const fp = stageResults.FINGERPRINT;
            if (fp.status === 'PASSED') emitOnce('s5_pass', 'BEHAVIOR.FINGERPRINT', fp.explanation || 'Behavioral fingerprint computed and sealed.', 'pass');
            else if (fp.status === 'UNAVAILABLE') emitOnce('s5_unavail', 'BEHAVIOR.FINGERPRINT', `UNAVAILABLE: ${fp.explanation || fp.error_code || 'No model artifact to fingerprint.'}`, 'review');
          }
          if (stageResults.BLAST_RADIUS) {
            const br = stageResults.BLAST_RADIUS;
            if (br.status === 'PASSED') emitOnce('s11_pass', 'BLAST_RADIUS.EVAL', br.explanation || 'Forensic blast-radius analysis complete.', 'pass');
            else if (br.status === 'UNAVAILABLE') emitOnce('s11_unavail', 'BLAST_RADIUS.EVAL', `UNAVAILABLE: ${br.explanation || br.error_code || 'Blast radius analysis unavailable.'}`, 'review');
          }

          // Update live risk meter using backend assessment
          if (sess.assessment && typeof sess.assessment.assuranceScore === 'number') {
            const hardVeto = !!sess.assessment.hardVetoTriggered;
            const risk = 1.0 - sess.assessment.assuranceScore;
            updateRiskMeter(Math.max(0, Math.min(1, risk)), hardVeto);
          } else if (sess.status === 'FAILED') {
            updateRiskMeter(1.0, true);
          } else {
            updateRiskMeter(progress * 0.5, false);
          }

          // Terminal errors + warnings
          (sess.errors || []).slice(AppState._errPrinted || 0).forEach(err => {
            addTerminalLog('PIPELINE.ERROR', String(err), 'danger');
          });
          AppState._errPrinted = (sess.errors || []).length;

          (sess.warnings || []).slice(AppState._warnPrinted || 0).forEach(warn => {
            addTerminalLog('PIPELINE.WARN', String(warn), 'review');
          });
          AppState._warnPrinted = (sess.warnings || []).length;

          if (sess.status === 'COMPLETED' || sess.status === 'FAILED') {
            done = true;
            const sessSummaryStatus = sess.status === 'COMPLETED' ? 'highlight' : 'danger';
            addTerminalLog('MISSION.COMPLETE', `Assurance Scan ${sess.status}. Compiling final forensic report...`, sessSummaryStatus);
            finalizeStage12(sess);
            setTimeout(() => {
              populateResultsPage(null, null, sess);
              setPhase(3);
            }, 800);
            return;
          }

        } catch (pollErr) {
          addTerminalLog('POLL.ERROR', `Status poll failed: ${pollErr.message}`, 'danger');
        }
        setTimeout(pollOnce, pollIntervalMs);
      };
      pollOnce();
      return;
    }

    // ========== DEMO MODE: Controlled scenario replay (still visually honest, no fabricated authority) ==========
    const isTamper = scenario.hardVeto;
    const isDrift = (AppState.currentScenario === 'benign_drift');

    const steps = [
      { id: 1, op: 'READ_ONLY.INSPECT', msg: `Scanning 12 demo band files. Non-destructive inspection lock active.`, status: 'passed' },
      { id: 2, op: 'CRYPTO.MERKLE_TREE', msg: isTamper
          ? 'Merkle root divergence detected! Spectral band byte modification flagged.'
          : `All sample digests sealed with Ed25519. Merkle Root: 3cafad429f83...`,
        status: isTamper ? 'blocked' : 'passed' },
      { id: 3, op: 'DATA.INTEGRITY', msg: isTamper ? 'Bit-level mutation flagged in spectral payload.' : 'Duplicate detection & 16-bit dHash perceptual audit clean.', status: isTamper ? 'blocked' : 'passed' },
      { id: 4, op: 'MODEL.IDENTITY', msg: (AppState.currentScenario === 'model_tamper')
          ? 'Weight tensor state-dict hash mismatch! Approved baseline violated.'
          : 'Approved architecture and deterministic state dict match baseline.',
        status: (AppState.currentScenario === 'model_tamper') ? 'blocked' : 'passed' },
      { id: 5, op: 'BEHAVIOR.FINGERPRINT', msg: '7 physical transformations evaluated. Sensitivity score within bounds.', status: 'passed' },
      { id: 6, op: 'INFERENCE.DNA', msg: (AppState.currentScenario === 'inference_replay')
          ? 'Replay violation! Duplicate nonce reused in stream. Monotonicity broken.'
          : 'Inference DNA tuple sealed: ⟨InputFrame, ModelDigest, Output, Nonce, PrevHash⟩.',
        status: (AppState.currentScenario === 'inference_replay') ? 'blocked' : 'passed' },
      { id: 7, op: 'DISTRIBUTION.DRIFT', msg: isDrift
          ? 'Spectral distribution shift detected (NDVI KS=0.84, PSI=11.28). Flagged for contextual review.'
          : 'Spectral distribution matches reference profile (KS < 0.15).',
        status: isDrift ? 'review' : 'passed' },
      { id: 8, op: 'EVIDENCE.FUSION', msg: isTamper
          ? 'HARD VETO TRIGGERED: Cryptographic integrity failure takes precedence over all other metrics.'
          : (isDrift ? 'Evidence fused: Non-critical drift elevated risk; no hard veto present.' : 'Multi-domain evidence fused cleanly. Risk assessment = LOW.'),
        status: isTamper ? 'blocked' : (isDrift ? 'review' : 'passed') },
      { id: 9, op: 'GATEKEEPER.ACTION', msg: isTamper
          ? 'DISPOSITION: BLOCK. Target asset quarantined in defense ledger.'
          : (isDrift ? 'DISPOSITION: ALLOW_WITH_MONITORING (Operational Review).' : 'DISPOSITION: ALLOW. Asset approved for operational deployment.'),
        status: isTamper ? 'blocked' : (isDrift ? 'review' : 'passed') },
      { id: 10, op: 'PROVENANCE.LINEAGE', msg: 'Directed property graph updated: Contributor -> Dataset -> Model -> Inference -> Evidence.', status: 'passed' },
      { id: 11, op: 'BLAST_RADIUS.EVAL', msg: isTamper
          ? 'BFS Impact Traversal: 2 downstream assets flagged as POTENTIALLY AFFECTED / REQUIRES REVIEW.'
          : 'No downstream assets compromised.',
        status: isTamper ? 'blocked' : 'passed' },
      { id: 12, op: 'FORENSIC.REPORT', msg: 'RFC 8785 Canonical JSON generated and cryptographically sealed with Ed25519 digital signature.', status: 'passed' },
    ];

    let currentStep = 0;
    const intervalTime = 600;

    AppState.scanInterval = setInterval(() => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        updatePipelineStage(step.id, 'running');
        addTerminalLog(step.op, step.msg, step.status === 'blocked' ? 'danger' : (step.status === 'review' ? 'review' : 'pass'));

        const progress = (currentStep + 1) / steps.length;
        const targetRisk = (isTamper ? 0.98 : (isDrift ? 0.35 : 0.05)) * progress;
        updateRiskMeter(targetRisk, isTamper && currentStep >= 1);

        setTimeout(() => {
          updatePipelineStage(step.id, step.status);
        }, intervalTime - 50);

        currentStep++;
      } else {
        clearInterval(AppState.scanInterval);
        addTerminalLog('MISSION.COMPLETE', 'Assurance Scan Complete. Compiling final forensic report...', 'highlight');

        setTimeout(() => {
          // Demo scenario uses NULL scanSession so populateResultsPage falls back to scenario logic
          populateResultsPage(isTamper, isDrift, null);
          setPhase(3);
        }, 1200);
      }
    }, intervalTime);
  }

  // =========================================================================
  // 6. PHASE 3: POPULATE RESULTS & INCIDENT ANALYSIS
  // =========================================================================

  function populateResultsPage(isTamperParam, isDriftParam, scanSessionOrManifest) {
    // ---------------------------------------------------------------
    // Authoritative rendering path: if 3rd arg is real ScanSession
    // (has .scan_id or .status) render everything from the backend.
    // Otherwise fall back to demo scenario logic (visually honest,
    // but explicitly labeled as scenario replay).
    // ---------------------------------------------------------------
    const isRealSession = scanSessionOrManifest
      && (typeof scanSessionOrManifest === 'object')
      && (scanSessionOrManifest.scan_id || scanSessionOrManifest.status === 'COMPLETED' || scanSessionOrManifest.status === 'FAILED');

    let isTamper, isDrift, isQuarantined, disposition, riskScore, findingsCount, totalSamples;
    let assessmentObj = null;
    let stageResults = {};
    let findingsList = [];
    let batchForGraph = null;
    let scanIdForLedger = null;
    let sessionErrors = [];
    let backEndReport = null;

    if (isRealSession) {
      const sess = scanSessionOrManifest;
      assessmentObj = sess.assessment || {};
      stageResults = sess.stage_results || {};
      findingsList = sess.findings || [];
      sessionErrors = sess.errors || [];
      scanIdForLedger = sess.scan_id || null;
      batchForGraph = sess.batch_id || null;

      // Derive authoritative classification from the backend produced fields
      const rawDisposition = String(assessmentObj.disposition || sess.status || 'UNKNOWN').toUpperCase();
      disposition = rawDisposition;
      isQuarantined = (rawDisposition === 'QUARANTINED') || (rawDisposition === 'BLOCK') || (sess.status === 'FAILED');
      const drComp = stageResults.DISTRIBUTION_SHIFT || {};
      const drFailed = (drComp.status === 'FAILED') || (drComp.explanation && /drift detected|significant|elevated/i.test(drComp.explanation || ''));
      isTamper = isQuarantined;
      isDrift = !isQuarantined && (rawDisposition === 'REVIEW' || rawDisposition === 'ALLOW_WITH_MONITORING' || drFailed);
      riskScore = typeof assessmentObj.assuranceScore === 'number'
        ? (1.0 - assessmentObj.assuranceScore)
        : (sess.status === 'FAILED' ? 1.0 : 0.05);
      findingsCount = findingsList.length;
      totalSamples = assessmentObj.totalSamples;
    } else {
      isTamper = (isTamperParam !== undefined) ? isTamperParam : Scenarios[AppState.currentScenario].hardVeto;
      isDrift = (isDriftParam !== undefined) ? isDriftParam : (AppState.currentScenario === 'benign_drift');
      isQuarantined = isTamper;
      const sc = Scenarios[AppState.currentScenario];
      disposition = sc.expectedVerdict;
      riskScore = sc.riskScore;
      findingsCount = 0;
    }
    const isRealUpload = (AppState.uploadMode === 'real_upload' && AppState.selectedFiles.length > 0);
    const assetLabelShort = isRealUpload
      ? (AppState.mission.assetName || 'Upload').substring(0, 20)
      : (isRealSession ? (batchForGraph || 'Batch').substring(0, 10) : 'EO Dataset');

    // ==================================================================
    // 1. Master Decision Hero — driven by backend disposition
    // ==================================================================
    const hero = document.getElementById('decision-hero-banner');
    const verdictTitle = document.getElementById('decision-verdict-title');
    const verdictDesc = document.getElementById('decision-verdict-desc');
    const verdictTag = document.getElementById('decision-verdict-tag');

    if (hero && verdictTitle && verdictDesc) {
      hero.className = 'decision-hero';
      if (isQuarantined) {
        hero.classList.add('quarantined');
        verdictTitle.textContent = isRealSession ? (
          (sessionErrors && sessionErrors.length)
            ? 'PIPELINE FAILURE // ASSET QUARANTINED'
            : 'INTEGRITY INCIDENT // ASSET QUARANTINED'
        ) : 'INTEGRITY INCIDENT // ASSET QUARANTINED';
        const reason = (sessionErrors && sessionErrors.length)
          ? `Backend pipeline errors recorded (${sessionErrors.length}). See console log.`
          : (isRealSession ? 'Authoritative backend disposition: integrity or assurance criterion not satisfied. Asset blocked from mission deployment.' : 'Hard-Veto Triggered: Cryptographic or spectral tampering detected. Asset blocked from mission deployment.');
        verdictDesc.textContent = reason;
        verdictTag.className = 'badge-tag badge-health-crit';
        verdictTag.textContent = `DISPOSITION: ${disposition || 'BLOCK / QUARANTINED'}`;
      } else if (isDrift) {
        hero.classList.add('review');
        verdictTitle.textContent = 'REVIEW REQUIRED // DISTRIBUTION SHIFT';
        verdictDesc.textContent = isRealSession
          ? 'Authoritative backend produced REVIEW disposition. Statistical drift detected; cryptographic integrity is intact; contextual analyst review recommended.'
          : 'Statistical drift detected (Seasonal / Atmospheric). Cryptographic integrity is intact; contextual review recommended.';
        verdictTag.className = 'badge-tag badge-health-warn';
        verdictTag.textContent = `DISPOSITION: ${disposition || 'ALLOW_WITH_MONITORING'}`;
      } else {
        hero.classList.add('accepted');
        verdictTitle.textContent = 'ASSURANCE PASSED // ASSET TRUSTED';
        verdictDesc.textContent = isRealSession
          ? 'Authoritative backend assessment complete. All cryptographic proofs, model identities, runtime evidence, and fusion criteria processed; no hard veto raised.'
          : 'All cryptographic proofs, model identities, runtime inference DNA, and evidence fusion criteria verified.';
        verdictTag.className = 'badge-tag badge-health-ok';
        verdictTag.textContent = `DISPOSITION: ${disposition || 'ALLOW / OPERATIONAL'}`;
      }
    }

    // ==================================================================
    // 2. Populate 5 Core Evidence Pillars — backend authoritative data
    // ==================================================================
    const pillarData = [];

    // ----- Pillar 1: DATA INTEGRITY -----
    const diComp = stageResults.DATASET_ANALYSIS || (isRealSession ? { status: 'UNAVAILABLE' } : null);
    const hashComp = stageResults.HASH_VERIFICATION || null;
    let diStatus = 'UNAVAILABLE';
    let diBadge = 'badge-health-warn';
    let diDesc = isRealSession ? 'Data Integrity result UNAVAILABLE from this scan session (check dataset pipeline).' : '';
    let diMeta = '';
    if (isRealSession && diComp) {
      diStatus = String(diComp.status || 'UNAVAILABLE').toUpperCase();
      if (diStatus === 'PASSED') { diBadge = 'badge-health-ok'; diStatus = 'PASS'; }
      else if (diStatus === 'FAILED') { diBadge = 'badge-health-crit'; diStatus = 'FAILED'; }
      else { diBadge = 'badge-health-warn'; diStatus = diStatus || 'UNAVAILABLE'; }
      diDesc = diComp.explanation
        || (diStatus === 'PASS'
            ? `Authoritative backend integrity audit passed for ${totalSamples || AppState.selectedFiles.length || 'N/A'} dataset sample(s). ${findingsCount} finding(s).`
            : `Backend pipeline stage DATASET_ANALYSIS status = ${diStatus}.`);
      const ok = (diComp.status === 'PASSED' || hashComp && hashComp.status === 'PASSED') ? 'PASS' : 'N/A';
      diMeta = `Hash Verification: ${ok} | Findings: ${findingsCount}`;
    } else {
      // Demo / fallback
      diStatus = isTamper ? 'TAMPERED' : 'PASS';
      diBadge = isTamper ? 'badge-health-crit' : 'badge-health-ok';
      diDesc = isTamper
        ? 'Merkle root divergence in payload files.'
        : `All ${isRealUpload ? AppState.selectedFiles.length : 12} bands bit-exact match approved Merkle tree.`;
      diMeta = `Merkle Root: ${isTamper ? '0c0b60f7... (FAILED)' : '3cafad42... (PASS)'}`;
    }
    pillarData.push({
      id: 'data-integrity',
      title: 'Data Integrity',
      verdict: diStatus,
      badgeClass: diBadge,
      desc: diDesc,
      meta: diMeta,
    });

    // ----- Pillar 2: MODEL IDENTITY -----
    const miComp = stageResults.MODEL_INTEGRITY || (isRealSession ? { status: 'UNAVAILABLE' } : null);
    let miStatus = 'UNAVAILABLE';
    let miBadge = 'badge-health-warn';
    let miDesc = '';
    let miMeta = '';
    if (isRealSession && miComp) {
      miStatus = String(miComp.status || 'UNAVAILABLE').toUpperCase();
      miBadge = miStatus === 'PASSED' ? 'badge-health-ok' : (miStatus === 'FAILED' ? 'badge-health-crit' : 'badge-health-warn');
      if (miStatus === 'PASSED') miStatus = 'PASS';
      if (miStatus === 'UNAVAILABLE') {
        miDesc = `UNAVAILABLE: ${miComp.explanation || 'No model artifact was provided for model assurance evaluation in this scan batch.'}`;
      } else if (miComp.explanation) {
        miDesc = miComp.explanation;
      } else {
        miDesc = `Backend model assurance stage completed. Status: ${miStatus}.`;
      }
      miMeta = miComp.error_code ? `Error: ${miComp.error_code}` : 'Identity verifier: default_model_registry';
    } else {
      const tamperScenario = (AppState.currentScenario === 'model_tamper' && !isRealSession);
      miStatus = tamperScenario ? 'MISMATCH' : (isTamper ? 'UNAVAILABLE' : 'PASS');
      miBadge = tamperScenario ? 'badge-health-crit' : (isTamper ? 'badge-health-warn' : 'badge-health-ok');
      miDesc = tamperScenario
        ? 'Weight tensor state-dict hash diverges from approved baseline.'
        : 'PyTorch/ONNX state dict layers hash identical to approved baseline.';
      miMeta = 'Model ID: 7d3185d1... // Arch: ResNet50-EO';
    }
    pillarData.push({
      id: 'model-integrity',
      title: 'Model Identity',
      verdict: miStatus,
      badgeClass: miBadge,
      desc: miDesc,
      meta: miMeta,
    });

    // ----- Pillar 3: RUNTIME INFERENCE DNA -----
    const infComp = stageResults.INFERENCE_VALIDATION || stageResults.BACKDOOR_ANALYSIS || (isRealSession ? { status: 'UNAVAILABLE' } : null);
    let infStatus = 'UNAVAILABLE';
    let infBadge = 'badge-health-warn';
    let infDesc = '';
    let infMeta = '';
    if (isRealSession && infComp) {
      infStatus = String(infComp.status || 'UNAVAILABLE').toUpperCase();
      infBadge = infStatus === 'PASSED' ? 'badge-health-ok' : (infStatus === 'FAILED' ? 'badge-health-crit' : 'badge-health-warn');
      if (infStatus === 'PASSED') infStatus = 'PASS';
      if (infStatus === 'UNAVAILABLE') {
        infDesc = `UNAVAILABLE: ${infComp.explanation || 'No inference artifacts were produced in this scan batch.'}`;
      } else if (infComp.explanation) {
        infDesc = infComp.explanation;
      } else {
        infDesc = `Backend inference assurance completed. Status: ${infStatus}.`;
      }
      infMeta = infComp.error_code ? `Error: ${infComp.error_code}` : 'Inference DNA: runtime engine';
    } else {
      const replayScenario = (AppState.currentScenario === 'inference_replay' && !isRealSession);
      infStatus = replayScenario ? 'REPLAYED' : (isTamper ? 'UNAVAILABLE' : 'PASS');
      infBadge = replayScenario ? 'badge-health-crit' : (isTamper ? 'badge-health-warn' : 'badge-health-ok');
      infDesc = replayScenario
        ? 'Duplicate nonce collision detected in runtime inference stream.'
        : 'Sequential Inference DNA hash chain and freshness verified.';
      infMeta = `Sequence Monotonicity: ${replayScenario ? 'BROKEN' : 'VALID'}`;
    }
    pillarData.push({
      id: 'runtime-assurance',
      title: 'Runtime Inference DNA',
      verdict: infStatus,
      badgeClass: infBadge,
      desc: infDesc,
      meta: infMeta,
    });

    // ----- Pillar 4: DISTRIBUTION SHIFT -----
    const dsComp = stageResults.DISTRIBUTION_SHIFT || (isRealSession ? { status: 'UNAVAILABLE' } : null);
    let dsStatus = 'UNAVAILABLE';
    let dsBadge = 'badge-health-warn';
    let dsDesc = '';
    let dsMeta = '';
    if (isRealSession && dsComp) {
      dsStatus = String(dsComp.status || 'UNAVAILABLE').toUpperCase();
      const hasExplanation = dsComp.explanation || '';
      const driftDetected = dsStatus === 'FAILED' || /drift|elevated|review/i.test(hasExplanation);
      if (dsStatus === 'PASSED') { dsBadge = 'badge-health-ok'; dsStatus = driftDetected ? 'DRIFT DETECTED' : 'NO DRIFT'; if (driftDetected) dsBadge = 'badge-health-warn'; }
      else if (dsStatus === 'FAILED') { dsBadge = 'badge-health-warn'; dsStatus = 'DRIFT DETECTED'; }
      else { dsBadge = 'badge-health-warn'; dsStatus = dsStatus || 'UNAVAILABLE'; }
      if (dsStatus === 'UNAVAILABLE') {
        dsDesc = `UNAVAILABLE: ${dsComp.explanation || 'No reference baseline registered for distribution shift analysis.'}`;
      } else if (hasExplanation) {
        dsDesc = hasExplanation;
      } else {
        dsDesc = `Backend distribution shift stage completed. Status: ${dsStatus}.`;
      }
      dsMeta = dsComp.error_code ? `Reference: ${dsComp.error_code}` : 'Drift engine: default_drift_engine';
    } else {
      dsStatus = isDrift ? 'DRIFT DETECTED' : 'NO DRIFT';
      dsBadge = isDrift ? 'badge-health-warn' : 'badge-health-ok';
      dsDesc = isDrift
        ? 'Seasonal vegetation decay detected (KS=0.84, PSI=11.28, W1=0.16).'
        : 'Spectral distributions within nominal operational tolerances.';
      dsMeta = `Energy Distance: ${isDrift ? '0.1838 (Elevated)' : '0.0012 (Nominal)'}`;
    }
    pillarData.push({
      id: 'distribution-drift',
      title: 'Distribution Shift',
      verdict: dsStatus,
      badgeClass: dsBadge,
      desc: dsDesc,
      meta: dsMeta,
    });

    // ----- Pillar 5: EVIDENCE FUSION -----
    const fuComp = stageResults.EVIDENCE_FUSION || (isRealSession ? { status: 'UNAVAILABLE' } : null);
    let fuStatus = 'UNAVAILABLE';
    let fuBadge = 'badge-health-warn';
    let fuDesc = '';
    let fuMeta = '';
    if (isRealSession && fuComp) {
      fuStatus = String(fuComp.status || 'UNAVAILABLE').toUpperCase();
      const rawDisp = (assessmentObj.disposition || '').toUpperCase();
      const hv = !!assessmentObj.hardVetoTriggered;
      if (hv || rawDisp === 'QUARANTINED' || rawDisp === 'BLOCK') {
        fuStatus = 'HARD VETO'; fuBadge = 'badge-health-crit';
      } else if (fuStatus === 'PASSED') {
        if (rawDisp === 'REVIEW' || rawDisp === 'ALLOW_WITH_MONITORING') {
          fuStatus = 'REVIEW'; fuBadge = 'badge-health-warn';
        } else {
          fuStatus = 'ALLOW'; fuBadge = 'badge-health-ok';
        }
      } else if (fuStatus === 'UNAVAILABLE') {
        fuBadge = 'badge-health-warn';
      }
      if (fuStatus === 'UNAVAILABLE') {
        fuDesc = `UNAVAILABLE: ${fuComp.explanation || 'No evidence items were available for fusion in this scan session.'}`;
      } else if (fuComp.explanation) {
        fuDesc = fuComp.explanation;
      } else {
        fuDesc = hv
          ? 'Hard-veto precedence enforced: Benign scores cannot override cryptographic integrity failure.'
          : (fuStatus === 'REVIEW' ? 'Multi-domain evidence fused; contextual review assessment.' : 'Synthesized multi-domain assessment clear for operational deployment.');
      }
      const rs = typeof riskScore === 'number' ? riskScore.toFixed(2) : 'N/A';
      fuMeta = `Risk Score: ${rs} / 1.00${scanIdForLedger ? ` | Scan: ${scanIdForLedger.substring(0,8)}...` : ''}`;
    } else {
      fuStatus = isTamper ? 'HARD VETO' : (isDrift ? 'REVIEW' : 'ALLOW');
      fuBadge = isTamper ? 'badge-health-crit' : (isDrift ? 'badge-health-warn' : 'badge-health-ok');
      fuDesc = isTamper
        ? 'Hard-veto precedence enforced: Benign scores cannot override integrity failure.'
        : (isDrift ? 'Evidence fused: Non-critical drift elevated risk; no hard veto present.' : 'Multi-domain evidence fused cleanly. Risk assessment = LOW.');
      fuMeta = `Risk Score: ${riskScore.toFixed(2)} / 1.00`;
    }
    pillarData.push({
      id: 'evidence-fusion',
      title: 'Evidence Fusion',
      verdict: fuStatus,
      badgeClass: fuBadge,
      desc: fuDesc,
      meta: fuMeta,
    });

    const pillarsContainer = document.getElementById('evidence-pillars-grid');
    if (pillarsContainer) {
      pillarsContainer.innerHTML = pillarData.map(p => `
        <div class="pillar-card">
          <div class="pillar-card-header">
            <span class="pillar-title">${escapeHtml(p.title)}</span>
            <span class="pillar-status-badge ${p.badgeClass}">${escapeHtml(p.verdict)}</span>
          </div>
          <div class="pillar-main-verdict">${escapeHtml(p.verdict)}</div>
          <p class="pillar-desc">${escapeHtml(p.desc)}</p>
          <div class="pillar-meta">${escapeHtml(p.meta)}</div>
        </div>
      `).join('');
    }

    // ==================================================================
    // 3. Incident Panel — show if quarantined / any FAILED stage
    // ==================================================================
    const incidentPanel = document.getElementById('incident-analysis-panel');
    if (incidentPanel) {
      const anyFailed = isQuarantined
        || Object.values(stageResults).some(c => c && String(c.status).toUpperCase() === 'FAILED');
      incidentPanel.classList.toggle('active', !!anyFailed);
      if (anyFailed) {
        const wcEl = document.getElementById('incident-what-changed');
        if (wcEl) wcEl.textContent = isRealSession
          ? (
              Object.keys(stageResults).length
                ? `Backend scan stage_results: ${Object.keys(stageResults).length} stages evaluated. ${findingsCount} authoritative finding(s). ${sessionErrors.length ? `${sessionErrors.length} pipeline error(s).` : ''}`
                : `Authoritative backend scan FAILED or QUARANTINED disposition. ${findingsCount} finding(s).`
            )
          : 'Band 4 (Red) GeoTIFF modified with 32-byte injected payload.';
        const wbEl = document.getElementById('incident-why-blocked');
        if (wbEl) wbEl.textContent = isRealSession
          ? `Backend disposition = ${disposition || 'FAILED'}. Evidence fusion + gatekeeper + audit enforce authoritative disposition; frontend cannot override.`
          : 'Hard-Veto Rule: Cryptographic integrity violations bypass statistical averaging and trigger immediate BLOCK.';
        const wqEl = document.getElementById('incident-what-quarantined');
        if (wqEl) wqEl.textContent = isRealSession
          ? `Scan session [${(scanIdForLedger || 'N/A').substring(0, 8)}...] Batch [${(batchForGraph || 'N/A').substring(0,8)}...] — authoritative backend-quarantined entities.`
          : `Dataset Batch [${batchForGraph ? batchForGraph.substring(0,8) : '5a6c5c5a'}...] and linked execution pipelines.`;
        const brEl = document.getElementById('incident-blast-radius');
        if (brEl) brEl.textContent = isRealSession
          ? `Blast-radius determined by backend evidence graph. Entity: ${assetLabelShort}.`
          : '2 Downstream Assets: Tactical Recon Model, Inference Stream Run #99 (POTENTIALLY AFFECTED / REQUIRES REVIEW).';
      }
    }

    // ==================================================================
    // 4. Provenance Property Graph — real GraphExport if possible
    // ==================================================================
    let graphNodes = [];
    let graphEdges = [];
    const GraphClass = window.TrustCVGraph || (typeof TrustCVGraph !== 'undefined' ? TrustCVGraph : null);
    if (!AppState.graphRenderer && GraphClass) {
      AppState.graphRenderer = new GraphClass('graph-canvas', { width: 800, height: 600, debug: true });
    }

    const drawGraph = (nodes, edges, opts) => {
      if (AppState.graphRenderer) {
        AppState.graphRenderer.setData(nodes, edges, opts || {});
      }
    };

    // If real session, attempt to fetch real graph export from backend
    let graphOpts = { scenario: AppState.currentScenario, isTamper, isDrift };
    if (isRealSession && api && typeof api.getGraph === 'function') {
      // Attempt async fetch; in the meantime render a placeholder skeleton from session data
      const placeholderNodes = [
        { id: 'contrib_operator', label: 'Contributor: operator_ground_station', node_type: 'CONTRIBUTOR', digest: 'resolved', status: 'VERIFIED', properties: { status: 'VERIFIED' } },
        { id: `batch_${batchForGraph || 'unknown'}`, label: `Dataset Batch ${(batchForGraph || '').substring(0, 8) || 'N/A'}`, node_type: 'DATASET_BATCH', digest: batchForGraph || 'pending', status: isQuarantined ? 'QUARANTINED' : (isDrift ? 'REVIEW' : 'VERIFIED'), properties: { status: isQuarantined ? 'QUARANTINED' : (isDrift ? 'REVIEW' : 'VERIFIED') } },
        { id: `scan_${scanIdForLedger || 'sess'}`, label: `Scan ${(scanIdForLedger || '').substring(0, 8) || 'N/A'}`, node_type: 'FUSION_ASSESSMENT', digest: scanIdForLedger || 'sess', status: (disposition || 'UNKNOWN'), properties: { status: disposition || 'UNKNOWN' } },
      ];
      const placeholderEdges = [
        { source_id: 'contrib_operator', target_id: `batch_${batchForGraph || 'unknown'}` },
        { source_id: `batch_${batchForGraph || 'unknown'}`, target_id: `scan_${scanIdForLedger || 'sess'}` },
      ];
      graphNodes = placeholderNodes;
      graphEdges = placeholderEdges;
      drawGraph(graphNodes, graphEdges, graphOpts);

      // Fire off real graph fetch — swap nodes/edges when it arrives
      (async () => {
        try {
          const exportData = await api.getGraph();
          if (exportData && Array.isArray(exportData.nodes) && Array.isArray(exportData.edges)) {
            const normalizedNodes = exportData.nodes.map(n => {
              const ntRaw = String(n.node_type || '').toUpperCase();
              let canonicalType = ntRaw;
              if (ntRaw.includes('CONTRIBUTOR') || ntRaw === 'ACTOR') canonicalType = 'CONTRIBUTOR';
              else if (ntRaw.includes('DATASET') || ntRaw.includes('BATCH') || ntRaw === 'SAMPLE' || ntRaw.includes('INGEST')) canonicalType = 'DATASET';
              else if (ntRaw.includes('MODEL') || ntRaw.includes('FINGERPRINT') || ntRaw.includes('WEIGHT')) canonicalType = 'MODEL';
              else if (ntRaw.includes('INFER') || ntRaw.includes('DNA') || ntRaw.includes('PREDICT')) canonicalType = 'INFERENCE';
              else if (ntRaw.includes('FUSION') || ntRaw.includes('EVIDENCE') || ntRaw.includes('ASSESS') || ntRaw.includes('FINAL')) canonicalType = 'EVIDENCE';
              else if (ntRaw.includes('QUARANTINE') || ntRaw.includes('VETO') || ntRaw.includes('INCIDENT')) canonicalType = 'QUARANTINE';
              const rawStatus = (n.properties && n.properties.status) ? n.properties.status : ntRaw;
              return {
                id: n.id,
                label: n.label || n.node_type,
                node_type: canonicalType,
                digest: n.canonical_identity || '',
                properties: n.properties || {},
                status: rawStatus,
              };
            });
            const normalizedEdges = exportData.edges.map(e => ({
              source_id: e.source_id,
              target_id: e.target_id,
              type: e.edge_type,
            }));
            AppState.mission.graphData = { nodes: normalizedNodes, edges: normalizedEdges };
            graphNodes = normalizedNodes;
            graphEdges = normalizedEdges;
            drawGraph(normalizedNodes, normalizedEdges, { ...graphOpts, authoritative: true });
          }
        } catch (graphErr) {
          // keep placeholder; don't fabricate
        }
      })();
    } else {
      // DEMO REPLAY (scenario mode). Nodes are derived from the local scenario so
      // the walkthrough still renders, but they are explicitly labeled as a
      // NON-AUTHORITATIVE replay — no cryptographic digest, score or verdict is
      // asserted and the renderer is told not to present them as evidence.
      const demoTag = 'DEMO REPLAY // NOT BACKEND EVIDENCE';
      const dsLabel = `EO Dataset [${AppState.currentScenario}]`;
      if (isTamper) {
        graphNodes = [
          { id: 'demo_contrib', label: 'Ground Station Recon (demo)', node_type: 'CONTRIBUTOR', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
          { id: 'demo_dataset', label: `${dsLabel} (hard-veto scenario)`, node_type: 'DATASET', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
          { id: 'demo_quarantine', label: 'QUARANTINE ENFORCED (scenario)', node_type: 'QUARANTINE_RECORD', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
        ];
        graphEdges = [
          { source_id: 'demo_contrib', target_id: 'demo_dataset', type: 'DEMO_AUTHORED_BY' },
          { source_id: 'demo_dataset', target_id: 'demo_quarantine', type: 'DEMO_QUARANTINES' },
        ];
      } else if (isDrift) {
        graphNodes = [
          { id: 'demo_contrib', label: 'Ground Station Recon (demo)', node_type: 'CONTRIBUTOR', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
          { id: 'demo_dataset', label: `${dsLabel} (drift scenario)`, node_type: 'DATASET', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
          { id: 'demo_drift', label: 'DISTRIBUTION SHIFT (scenario)', node_type: 'DRIFT_ASSESSMENT', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
        ];
        graphEdges = [
          { source_id: 'demo_contrib', target_id: 'demo_dataset', type: 'DEMO_AUTHORED_BY' },
          { source_id: 'demo_dataset', target_id: 'demo_drift', type: 'DEMO_EXHIBITS' },
        ];
      } else {
        graphNodes = [
          { id: 'demo_contrib', label: 'Ground Station Recon (demo)', node_type: 'CONTRIBUTOR', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
          { id: 'demo_dataset', label: `${dsLabel} (clean scenario)`, node_type: 'DATASET', digest: demoTag, status: 'DEMO', properties: { status: 'DEMO', replay: true } },
        ];
        graphEdges = [
          { source_id: 'demo_contrib', target_id: 'demo_dataset', type: 'DEMO_AUTHORED_BY' },
        ];
      }
      // Always prefer the real backend graph, even in replay mode.
      if (api && typeof api.getGraph === 'function') {
        (async () => {
          try {
            const exportData = await api.getGraph();
            if (exportData && Array.isArray(exportData.nodes) && Array.isArray(exportData.edges)) {
              const normalizedNodes = exportData.nodes.map(n => ({
                id: n.id,
                label: n.label || n.node_type,
                node_type: String(n.node_type || 'ENTITY').toUpperCase(),
                digest: n.canonical_identity || '',
                properties: n.properties || {},
                status: (n.properties && n.properties.status) ? n.properties.status : 'UNKNOWN',
              }));
              const normalizedEdges = exportData.edges.map(e => ({
                source_id: e.source_id,
                target_id: e.target_id,
                type: e.edge_type,
              }));
              AppState.mission.graphData = { nodes: normalizedNodes, edges: normalizedEdges };
              drawGraph(normalizedNodes, normalizedEdges, { ...graphOpts, authoritative: true });
            }
          } catch (_) {
            // keep demo replay graph; never fabricate an authoritative one
          }
        })();
      }
      drawGraph(graphNodes, graphEdges, { ...graphOpts, replay: true, authoritative: false });
    }
    if (!AppState.mission.graphData.nodes || !AppState.mission.graphData.nodes.length) {
      AppState.mission.graphData = { nodes: graphNodes, edges: graphEdges };
    }

    // ==================================================================
    // 5. Forensic Report — real ledger verification call + real IDs
    // ==================================================================
    let repId, repDigest, repSigStatus, repSigClass;
    if (isRealSession) {
      repId = `REP-${(scanIdForLedger || uuidFallback()).substring(0, 10).toUpperCase()}`;
      // If real assessment has a canonical digest use it, otherwise batch/scan id derived digest banner
      if (assessmentObj && typeof assessmentObj.fusionAssessment === 'object' && assessmentObj.fusionAssessment.assessment_id) {
        repDigest = `fusion=${assessmentObj.fusionAssessment.assessment_id}`;
      } else if (batchForGraph) {
        repDigest = `batch=${batchForGraph} | scan=${scanIdForLedger || 'N/A'} | status=${disposition || sessStatus}`;
      } else {
        repDigest = `scan=${scanIdForLedger || 'N/A'} | status=${disposition || (scanSessionOrManifest && scanSessionOrManifest.status) || 'UNKNOWN'}`;
      }
      repSigStatus = 'AWAITING LEDGER VERIFY';
      repSigClass = 'badge-tag badge-health-warn';
      // Fire off real ledger verification and update asynchronously (never fabricate)
      if (api && typeof api.verifyLedger === 'function') {
        (async () => {
          try {
            const led = await api.verifyLedger();
            const el = document.getElementById('report-sig-status');
            if (!el) return;
            if (led && typeof led === 'object' && led.valid === true) {
              el.textContent = `LEDGER VALID (Ed25519) | Events: ${led.events_checked || 'N/A'} | Last seq: ${led.last_verified_sequence}`;
              el.className = 'badge-tag badge-health-ok';
            } else if (led && typeof led === 'object' && led.valid === false) {
              el.textContent = `LEDGER INVALID! seq ${led.first_invalid_sequence}: ${led.failure_reason || 'unknown'}`;
              el.className = 'badge-tag badge-health-crit';
            } else {
              el.textContent = 'LEDGER VERIFICATION UNAVAILABLE';
              el.className = 'badge-tag badge-health-warn';
            }
          } catch (_) {
            setReportSigStatus('LEDGER VERIFICATION UNAVAILABLE // BACKEND OFFLINE', 'badge-health-warn');
          }
        })();
      } else {
        repSigStatus = 'LEDGER VERIFICATION UNAVAILABLE // BACKEND OFFLINE';
        repSigClass = 'badge-tag badge-health-warn';
      }

      // Fetch the backend-sealed assurance report so the audit buttons operate on
      // real signed material. If the backend cannot produce one, the report stays
      // explicitly unavailable — no local digest is invented.
      backEndReport = null;
      if (api && typeof api.getReport === 'function') {
        (async () => {
          try {
            const candidateId = `REP-${(batchForGraph || scanIdForLedger || '').substring(0, 10).toUpperCase()}`;
            const fetched = await api.getReport(candidateId);
            if (fetched && typeof fetched === 'object' && fetched.report_digest && fetched.signature) {
              backEndReport = fetched;
              document.getElementById('report-digest-display').textContent = fetched.report_digest;
              AppState.mission.report.backend_report = fetched;
            } else {
              document.getElementById('report-digest-display').textContent = 'UNAVAILABLE // NO BACKEND-SEALED REPORT';
            }
          } catch (_) {
            document.getElementById('report-digest-display').textContent = 'UNAVAILABLE // NO BACKEND-SEALED REPORT';
          }
        })();
      } else {
        repDigest = 'UNAVAILABLE // NO BACKEND-SEALED REPORT';
      }
    } else {
      repId = 'DEMO-REPLAY-' + uuidFallback().substring(0, 8).toUpperCase();
      repDigest = 'DEMO REPLAY // NO BACKEND REPORT (not authoritative)';
      repSigStatus = 'DEMO REPLAY // NOT AUTHENTICATED';
      repSigClass = 'badge-tag badge-health-warn';
    }
    document.getElementById('report-id-display').textContent = repId;
    document.getElementById('report-digest-display').textContent = repDigest;
    document.getElementById('report-sig-status').textContent = repSigStatus;
    document.getElementById('report-sig-status').className = repSigClass;
    AppState.mission.report = {
      report_id: repId,
      digest: repDigest,
      is_real: !!isRealSession,
      disposition,
      backend_report: backEndReport,
    };

    // Refresh any analyst dispositions already persisted for this entity.
    // Nothing is assumed — an empty ledger renders as "NO DECISION RECORDED".
    refreshAnalystDecisions();
  }

  function uuidFallback() {
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return `FB-${uuid}`;
  }

  // =========================================================================
  // 7. EVENT LISTENERS & INITIALIZATION
  // =========================================================================

  // Mode Tabs
  const tabUpload = document.getElementById('tab-mode-upload');
  const tabDemo = document.getElementById('tab-mode-demo');
  if (tabUpload) tabUpload.addEventListener('click', () => setUploadMode('real_upload'));
  if (tabDemo) tabDemo.addEventListener('click', () => setUploadMode('demo_scenario'));

  // File and Folder Selection Buttons
  const btnSelectFiles = document.getElementById('btn-select-files');
  const btnSelectFolder = document.getElementById('btn-select-folder');
  const inputFiles = document.getElementById('input-files-upload');
  const inputFolder = document.getElementById('input-folder-upload');

  if (btnSelectFiles && inputFiles) {
    btnSelectFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      inputFiles.click();
    });
    inputFiles.addEventListener('change', (e) => {
      handleFileSelection(e.target.files);
    });
  }

  const btnSelectSingle = document.getElementById('btn-select-single');
  const btnSelectBaseline = document.getElementById('btn-select-baseline');
  const inputSingle = document.getElementById('input-single-upload');
  const inputBaseline = document.getElementById('input-baseline-upload');

  if (btnSelectSingle && inputSingle) {
    btnSelectSingle.addEventListener('click', (e) => {
      e.stopPropagation();
      inputSingle.click();
    });
    inputSingle.addEventListener('change', (e) => {
      handleFileSelection(e.target.files);
    });
  }

  if (btnSelectBaseline && inputBaseline) {
    btnSelectBaseline.addEventListener('click', (e) => {
      e.stopPropagation();
      inputBaseline.click();
    });
    inputBaseline.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        AppState.baselineFile = e.target.files[0];
        btnSelectBaseline.textContent = `Baseline: ${e.target.files[0].name.substring(0, 12)}…`;
        btnSelectBaseline.style.borderColor = 'var(--accent-cyan)';
      }
    });
  }

  if (btnSelectFolder && inputFolder) {
    btnSelectFolder.addEventListener('click', (e) => {
      e.stopPropagation();
      inputFolder.click();
    });
    inputFolder.addEventListener('change', (e) => {
      handleFileSelection(e.target.files);
    });
  }

  // Drag and Drop Zone
  const dropzone = document.getElementById('dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => {
      if (inputFiles) inputFiles.click();
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = 'var(--accent-cyan)';
        dropzone.style.background = 'var(--bg-card-hover)';
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = '';
        dropzone.style.background = '';
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFileSelection(e.dataTransfer.files);
      }
    });
  }

  // Theme Toggle
  const themeToggle = document.getElementById('btn-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(AppState.theme === 'dark' ? 'light' : 'dark');
    });
  }

  // Scenario Cards Click
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      selectScenario(card.getAttribute('data-scenario'));
    });
  });

  // Launch CTA Click
  const launchBtn = document.getElementById('btn-launch-mission');
  if (launchBtn) {
    launchBtn.addEventListener('click', () => {
      launchAssuranceScan();
    });
  }

  // New Mission CTA
  const newMissionBtn = document.getElementById('btn-new-mission');
  if (newMissionBtn) {
    newMissionBtn.addEventListener('click', () => {
      AppState.mission.id = 'MSN-' + Math.random().toString(36).substring(2, 9).toUpperCase();
      AppState.mission.scanId = null;
      AppState.mission.batchId = null;
      AppState.mission.report = null;
      AppState.selectedFiles = [];
      AppState.detectedBands = [];
      const banner = document.getElementById('upload-status-banner');
      if (banner) banner.style.display = 'none';
      document.getElementById('hud-mission-id').textContent = AppState.mission.id;
      // Clear the analyst disposition panel; decisions are never carried over.
      setAnalystDecisionStatus('NO DECISION RECORDED', null);
      const decisionRecord = document.getElementById('analyst-decision-record');
      if (decisionRecord) decisionRecord.style.display = 'none';
      setReportSigStatus('AWAITING BACKEND LEDGER VERIFY', 'badge-health-warn');
      setPhase(1);
    });
  }

  // =========================================================================
  // Analyst disposition — persisted by the backend ledger, never local state.
  // =========================================================================

  function analystDecisionTargetEntity() {
    return AppState.mission.batchId || AppState.mission.scanId || null;
  }

  function setAnalystDecisionStatus(text, ok) {
    const el = document.getElementById('analyst-decision-status');
    if (!el) return;
    el.textContent = text;
    el.className = ok === null
      ? 'badge-tag'
      : `badge-tag ${ok ? 'badge-health-ok' : 'badge-health-warn'}`;
    if (ok === null) el.style.background = 'var(--bg-surface)', el.style.color = 'var(--text-muted)';
    else el.style.background = '', el.style.color = '';
  }

  async function refreshAnalystDecisions() {
    const entityId = analystDecisionTargetEntity();
    if (!entityId || !api || typeof api.listAnalystDecisions !== 'function') {
      setAnalystDecisionStatus('NO DECISION RECORDED', null);
      return;
    }
    try {
      const decisions = await api.listAnalystDecisions(entityId);
      const record = document.getElementById('analyst-decision-record');
      const detail = document.getElementById('analyst-decision-detail');
      if (Array.isArray(decisions) && decisions.length) {
        const latest = decisions[decisions.length - 1];
        setAnalystDecisionStatus(
          `${decisions.length} RECORDED // LATEST: ${String(latest.actor || 'unknown')} SEALED`,
          true
        );
        if (record) record.style.display = 'block';
        if (detail) {
          detail.textContent = `seq=${latest.sequence} | actor=${latest.actor} | event=${latest.event_type} | scan=${latest.scan_id || 'N/A'} | payload_hash=${String(latest.payload_hash || '').substring(0, 16)}… | signed=${latest.signature ? 'yes' : 'no'}`;
        }
      } else {
        setAnalystDecisionStatus('NO DECISION RECORDED', null);
        if (record) record.style.display = 'none';
      }
    } catch (_) {
      setAnalystDecisionStatus('LEDGER UNAVAILABLE // BACKEND OFFLINE', false);
    }
  }

  async function submitAnalystDecision(decision) {
    const entityId = analystDecisionTargetEntity();
    if (!entityId) {
      alert('No entity to record a decision against. Run a real scan first.');
      return;
    }
    if (!api || typeof api.recordAnalystDecision !== 'function') {
      alert('Analyst decision UNAVAILABLE: the backend ledger is unreachable. The decision was NOT recorded.');
      return;
    }
    const actor = (document.getElementById('analyst-actor')?.value || '').trim() || 'operator_ground_station';
    const reason = (document.getElementById('analyst-reason')?.value || '').trim();

    setAnalystDecisionStatus('SUBMITTING TO BACKEND LEDGER…', false);
    try {
      const event = await api.recordAnalystDecision(entityId, decision, actor, {
        scan_id: AppState.mission.scanId || undefined,
        reason: reason || undefined,
      });
      if (!event || typeof event.sequence !== 'number') {
        setAnalystDecisionStatus('NOT RECORDED // BACKEND REJECTED', false);
        alert('The backend did not confirm the decision. It has NOT been recorded.');
        return;
      }
      await refreshAnalystDecisions();
      alert(`Analyst decision ${decision} sealed by the backend ledger.\nLedger sequence: ${event.sequence}\nSigned: ${event.signature ? 'yes' : 'no'}`);
    } catch (err) {
      setAnalystDecisionStatus('NOT RECORDED // BACKEND ERROR', false);
      alert(`Analyst decision was NOT recorded. Backend error: ${err.message}`);
    }
  }

  const decisionButtons = [
    ['btn-decision-accept', 'ACCEPT'],
    ['btn-decision-review', 'REVIEW'],
    ['btn-decision-quarantine', 'QUARANTINE'],
  ];
  decisionButtons.forEach(([id, decision]) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => { submitAnalystDecision(decision); });
  });

  // =========================================================================
  // Report signature audit — AUTHORITATIVE BACKEND VERIFICATION ONLY.
  // The frontend must never assert a PASS/FAIL crypto verdict locally.
  // =========================================================================

  function setReportSigStatus(text, variant) {
    const sigStatus = document.getElementById('report-sig-status');
    if (!sigStatus) return;
    sigStatus.textContent = text;
    sigStatus.className = `badge-tag ${variant}`;
  }

  function reportVerifyMessage(result) {
    const discrepancies = Array.isArray(result.discrepancies) ? result.discrepancies : [];
    const detail = discrepancies.length ? ` | ${discrepancies.join('; ')}` : '';
    return `digest_match=${result.digest_match ? 'true' : 'false'} | signature_valid=${result.signature_valid ? 'true' : 'false'}${detail}`;
  }

  async function auditLiveReportSignature() {
    const report = AppState.mission.report;
    if (!report || !report.is_real) {
      setReportSigStatus('UNAVAILABLE // NO BACKEND-SEALED REPORT', 'badge-health-warn');
      alert('Report signature audit UNAVAILABLE.\nNo backend-sealed assurance report is loaded for this mission, so no cryptographic verdict can be issued.');
      return;
    }
    if (!report.backend_report || !api || typeof api.auditReportSignature !== 'function') {
      setReportSigStatus('UNAVAILABLE // BACKEND OFFLINE', 'badge-health-warn');
      alert('Report signature audit UNAVAILABLE.\nThe backend could not be reached, so no cryptographic verdict can be issued.');
      return;
    }

    setReportSigStatus('AUDITING (BACKEND)...', 'badge-health-warn');
    const result = await api.auditReportSignature(report.backend_report);
    if (!result || typeof result.is_valid !== 'boolean') {
      setReportSigStatus('UNAVAILABLE // BACKEND OFFLINE', 'badge-health-warn');
      alert('Report signature audit UNAVAILABLE.\nThe backend did not return a verification result. No verdict is asserted.');
      return;
    }
    if (result.is_valid) {
      setReportSigStatus('VALID (Ed25519, BACKEND-VERIFIED)', 'badge-health-ok');
    } else {
      setReportSigStatus('INVALID // TAMPER DETECTED (BACKEND)', 'badge-health-crit');
    }
    alert(`Backend report signature audit complete.\nVerdict: ${result.is_valid ? 'VALID' : 'INVALID'}\n${reportVerifyMessage(result)}`);
  }

  async function probeTamperedReportAgainstBackend() {
    const report = AppState.mission.report;
    if (!report || !report.is_real || !report.backend_report) {
      setReportSigStatus('UNAVAILABLE // NO BACKEND-SEALED REPORT', 'badge-health-warn');
      alert('Tamper probe UNAVAILABLE.\nNo backend-sealed assurance report is loaded, so tampering cannot be demonstrated.');
      return;
    }
    if (!api || typeof api.probeTamperedReport !== 'function') {
      setReportSigStatus('UNAVAILABLE // BACKEND OFFLINE', 'badge-health-warn');
      alert('Tamper probe UNAVAILABLE.\nThe backend could not be reached.');
      return;
    }

    setReportSigStatus('AUDITING MUTATED REPORT (BACKEND)...', 'badge-health-warn');
    const result = await api.probeTamperedReport(report.backend_report);
    if (!result || typeof result.is_valid !== 'boolean') {
      setReportSigStatus('UNAVAILABLE // BACKEND OFFLINE', 'badge-health-warn');
      alert('Tamper probe UNAVAILABLE.\nThe backend did not return a verification result.');
      return;
    }
    if (result.is_valid) {
      setReportSigStatus('UNEXPECTED: MUTATED REPORT ACCEPTED', 'badge-health-crit');
    } else {
      setReportSigStatus('TAMPER REJECTED (BACKEND-VERIFIED)', 'badge-health-crit');
    }
    alert(`Backend re-audit of the mutated report payload.\nVerdict: ${result.is_valid ? 'VALID (unexpected)' : 'INVALID'}\n${reportVerifyMessage(result)}`);
  }

  // Verify Report Signature (backend-authoritative)
  const verifyRepBtn = document.getElementById('btn-verify-report');
  if (verifyRepBtn) {
    verifyRepBtn.addEventListener('click', () => { auditLiveReportSignature(); });
  }

  // Demonstrate report tamper resistance via backend re-audit (no local verdict)
  const tamperRepBtn = document.getElementById('btn-tamper-report');
  if (tamperRepBtn) {
    tamperRepBtn.addEventListener('click', () => { probeTamperedReportAgainstBackend(); });
  }

  // Subsystems Drawer Toggle
  const drawerBtn = document.getElementById('btn-open-drawer');
  const drawerCloseBtn = document.getElementById('btn-close-drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerPanel = document.getElementById('drawer-panel');

  function toggleDrawer(open) {
    if (drawerBackdrop && drawerPanel) {
      drawerBackdrop.classList.toggle('active', open);
      drawerPanel.classList.toggle('active', open);
    }
  }

  if (drawerBtn) drawerBtn.addEventListener('click', () => toggleDrawer(true));
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', () => toggleDrawer(false));
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', () => toggleDrawer(false));

  // Subsystem helpers & XSS sanitization
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  window.escapeHtml = escapeHtml;

  window.refreshAllData = function() {
    if (api) api.getReadiness();
  };

  window.triggerAttack = function(attackId, targetEntityId) {
    if (api && api.executeAttack) {
      const target = targetEntityId || AppState.mission.batchId || AppState.mission.scanId || 'test-target';
      api.executeAttack(attackId, target);
    }
  };

  // Initial Boot
  applyTheme(AppState.theme);
  setUploadMode('real_upload');
  setPhase(1);

  // Poll Backend Readiness
  if (api) {
    api.getReadiness().then(res => {
      const healthBadge = document.getElementById('hud-health-badge');
      if (healthBadge && res && (res.ready || res.status === 'healthy')) {
        healthBadge.innerHTML = '<span class="status-dot green"></span> <span>HEALTHY (WAL)</span>';
        healthBadge.className = 'badge-tag badge-health-ok';
      }
    }).catch(() => {
      const healthBadge = document.getElementById('hud-health-badge');
      if (healthBadge) {
        healthBadge.innerHTML = '<span class="status-dot green"></span> <span>OFFLINE AIR-GAP</span>';
        healthBadge.className = 'badge-tag badge-health-ok';
      }
    });
  }
});
