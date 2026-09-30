import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface BackendStatusProps {
  online: boolean;
  compact?: boolean;
}

/**
 * BackendStatus chip — shows whether the FastAPI backend is reachable.
 * A simple pill: static colored dot + short label. No pulse, no glow.
 */
export const BackendStatus: React.FC<BackendStatusProps> = ({ online, compact = false }) => {
  return (
    <div
      role="status"
      aria-label={online ? 'Backend server connected' : 'Air-gapped offline mode'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: compact ? '0.25rem 0.625rem' : '0.375rem 0.75rem',
        backgroundColor: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '999px',
      }}
    >
      {/* Static status dot */}
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: online ? 'var(--success)' : 'var(--warning)',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />

      {online ? (
        <Wifi size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      ) : (
        <WifiOff size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      )}

      {!compact && (
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          {online ? 'Connected' : 'Air-gapped'}
        </span>
      )}
    </div>
  );
};
