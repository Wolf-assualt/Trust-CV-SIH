import React from 'react';

interface BackendStatusProps {
  online: boolean;
  compact?: boolean;
}

/**
 * BackendStatus — "Connected" pill. Status dot plus short label; the colour
 * of the dot is the only thing that changes between states. No pulse, no glow.
 */
export const BackendStatus: React.FC<BackendStatusProps> = ({ online, compact = false }) => {
  return (
    <div
      role="status"
      aria-label={online ? 'Backend server connected' : 'Air-gapped offline mode'}
      className="chip"
    >
      <span
        className="status-dot"
        style={{ backgroundColor: online ? 'var(--success)' : 'var(--warning)' }}
        aria-hidden="true"
      />
      {!compact && (online ? 'Connected' : 'Air-gapped')}
    </div>
  );
};