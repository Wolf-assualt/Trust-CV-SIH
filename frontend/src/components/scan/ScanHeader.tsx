import React from 'react';
import { Terminal, Clock, Play } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { BackendStatus } from '../ui/BackendStatus';

/**
 * ScanHeader — displays real backend scan progress controls.
 *
 * Phase 8 changes:
 * - Removed "Speed Multiplier" (1X/2X/5X) — meaningless when progress comes
 *   from the backend; incrementing the interval would not accelerate analysis.
 * - Removed "Skip to End" — would have moved to the results page before the
 *   backend completed, showing UNAVAILABLE for all results.
 * - "Re-Run Scan" re-uses the existing scan_id from the current upload session
 *   rather than starting a new one; the upload must be repeated for a new scan.
 */
export const ScanHeader: React.FC = () => {
  const {
    sessionId,
    currentScanId,
    elapsedSeconds,
    isScanning,
    isScanCompleted,
    scanProgress,
    startScan,
    backendOnline,
    setPhase,
  } = useInvestigation();

  const formatElapsed = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
      }}
    >
      {/* Title & Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '0.375rem',
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
        >
          <Terminal size={18} strokeWidth={1.5} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              Integrity Analysis Terminal
            </h2>
            {isScanCompleted ? (
              <Badge variant="success" size="sm">Analysis complete</Badge>
            ) : isScanning ? (
              <Badge variant="accent" size="sm">Scan in progress</Badge>
            ) : scanProgress > 0 ? (
              <Badge variant="warning" size="sm">Paused ({scanProgress}%)</Badge>
            ) : (
              <Badge variant="default" size="sm">Ready to initialize</Badge>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Session: <strong className="font-mono" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{sessionId}</strong>
            </span>
            {currentScanId && (
              <>
                <span style={{ color: 'var(--border-strong)', fontSize: '12px' }}>·</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Scan: <strong className="font-mono" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{currentScanId.substring(0, 8)}…</strong>
                </span>
              </>
            )}
            <span style={{ color: 'var(--border-strong)', fontSize: '12px' }}>·</span>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Clock size={13} strokeWidth={1.5} />
              Elapsed: <strong className="font-mono" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{formatElapsed(elapsedSeconds)}</strong>
            </span>
            <BackendStatus online={backendOnline} compact />
          </div>
        </div>
      </div>

      {/* Scan Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {!isScanCompleted && !isScanning && (
          <Button
            variant="primary"
            size="sm"
            onClick={startScan}
            icon={<Play size={14} strokeWidth={1.5} />}
          >
            Start Forensic Scan
          </Button>
        )}

        {isScanCompleted && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setPhase('results')}
          >
            View Verdict & Evidence
          </Button>
        )}
      </div>
    </div>
  );
};
