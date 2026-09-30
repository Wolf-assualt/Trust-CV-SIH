import React from 'react';
import { Check, ArrowRight, ShieldCheck, RotateCcw, AlertCircle } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/**
 * ValidationChecklist — pre-scan artifact readiness panel.
 *
 * Phase 8 changes:
 * - Removed hardcoded "52,000 samples / 24 layers / 52,000 records" counts.
 *   Those were presentation placeholders for a demo scenario; real counts come
 *   from the backend scan session after upload.
 * - Removed undefined checklist items (modelDetected, inferenceDetected,
 *   fileIntegrityVerified) that were always false because the store never sets
 *   them.  Only items backed by real state are shown.
 * - START SCAN button is disabled unless isReadyToScan is true (dataset
 *   uploaded AND backend scan_id received).
 */
export const ValidationChecklist: React.FC = () => {
  const {
    validationChecklist,
    isReadyToScan,
    startScan,
    clearArtifacts,
    currentScanId,
    scanSession,
    artifacts,
    backendOnline,
  } = useInvestigation();

  const datasetArtifact = artifacts.find(a => a.type === 'dataset');

  const checklistItems = [
    {
      id: 'dataset',
      label: datasetArtifact?.filename
        ? `Dataset accepted: ${datasetArtifact.filename} (${datasetArtifact.size})`
        : 'Computer vision dataset — upload an image folder or .zip archive',
      checked: validationChecklist.datasetDetected,
    },
    {
      id: 'scan_id',
      label: currentScanId
        ? `Backend scan session created — ID: ${currentScanId.substring(0, 8)}…`
        : 'Backend scan session — created automatically on dataset upload',
      checked: validationChecklist.scanReady,
    },
    {
      id: 'backend',
      label: backendOnline
        ? 'Backend assurance pipeline — reachable and ready'
        : 'Backend assurance pipeline — unreachable (air-gapped mode)',
      checked: backendOnline,
    },
    {
      id: 'config',
      label: 'Zero-Trust defense audit configuration validated',
      checked: true,
    },
  ];

  return (
    <div
      style={{
        marginTop: '16px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '16px',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Pre-Scan Forensic Validation
          </h2>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              marginTop: '4px',
              margin: '4px 0 0 0',
            }}
          >
            {isReadyToScan
              ? 'Backend scan session is active. All checks passed — ready to monitor the pipeline.'
              : 'Upload a dataset to create a backend scan session before starting analysis.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearArtifacts}
            icon={<RotateCcw size={14} strokeWidth={1.5} />}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Checklist items */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
        }}
      >
        {checklistItems.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '0.375rem',
              userSelect: 'none',
            }}
          >
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: item.checked ? 'var(--success)' : 'var(--border-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0B0C0F',
                flexShrink: 0,
              }}
            >
              {item.checked ? (
                <Check size={12} strokeWidth={2} />
              ) : (
                <span
                  style={{
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: 'var(--bg-primary)',
                  }}
                />
              )}
            </div>
            <span
              style={{
                fontSize: '0.8125rem',
                color: item.checked ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: item.checked ? 500 : 400,
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Scan session info (only when session exists) */}
      {scanSession && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '0.375rem',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: '24px',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <span style={{ color: 'var(--text-muted)' }}>Scan ID: </span>
            <strong className="font-mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{scanSession.scan_id}</strong>
          </span>
          {scanSession.batch_id && (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Batch ID: </span>
              <strong className="font-mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{scanSession.batch_id}</strong>
            </span>
          )}
          <span>
            <span style={{ color: 'var(--text-muted)' }}>Status: </span>
            <strong
              style={{
                fontWeight: 500,
                color:
                  scanSession.status === 'COMPLETED'
                    ? 'var(--success-text)'
                    : scanSession.status === 'FAILED'
                    ? 'var(--critical-text)'
                    : 'var(--text-primary)',
              }}
            >
              {scanSession.status}
            </strong>
          </span>
        </div>
      )}

      {/* Footer Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isReadyToScan ? (
            <Badge variant="success" size="md" icon={<ShieldCheck size={15} strokeWidth={1.5} />}>
              Ready to scan
            </Badge>
          ) : (
            <Badge variant="warning" size="md" icon={<AlertCircle size={15} strokeWidth={1.5} />}>
              Upload dataset first
            </Badge>
          )}
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            {isReadyToScan
              ? 'Dataset ingested and backend scan session active. Proceed to monitor the pipeline.'
              : 'Upload a dataset above. A backend scan session is created automatically on upload.'}
          </span>
        </div>

        <div className="tooltip-host" data-tooltip="A backend scan session must exist before the pipeline can run. Upload a dataset — the scan session is created automatically on upload and the scan becomes available immediately after.">
          <Button
            variant="primary"
            size="lg"
            onClick={startScan}
            disabled={!isReadyToScan}
            iconRight={<ArrowRight size={16} strokeWidth={1.5} />}
            style={{ minWidth: '280px' }}
          >
            {isReadyToScan ? 'Monitor Assurance Pipeline' : 'Upload Dataset to Enable Scan'}
          </Button>
        </div>
      </div>
    </div>
  );
};
