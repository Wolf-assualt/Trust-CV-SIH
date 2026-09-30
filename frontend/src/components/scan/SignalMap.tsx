import React, { useState } from 'react';
import { useInvestigation } from '../../state/investigationStore';
import type { SignalPoint } from '../../types/investigation';
import { Badge } from '../ui/Badge';

export const SignalMap: React.FC = () => {
  const { signalPoints, liveMetrics } = useInvestigation();
  const [hoveredPoint, setHoveredPoint] = useState<SignalPoint | null>(null);

  const poisonedCount = liveMetrics.poisonedSamples;
  const oodCount = liveMetrics.oodCandidates;
  const normalCount = Math.max(0, (liveMetrics.totalSamples || signalPoints.length) - poisonedCount - oodCount);

  return (
    <div
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        height: '380px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Title & Legend Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
          zIndex: 2,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Integrity Signal Map (Latent Feature Space)
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Visual embedding cluster deviation separating nominal data from backdoor triggers
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent)', opacity: 0.7 }} />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Normal ({normalCount.toLocaleString()})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning)', opacity: 0.8 }} />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              OOD ({oodCount.toLocaleString()})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--critical)', opacity: 0.8 }} />
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Poisoned ({poisonedCount.toLocaleString()})
            </span>
          </div>
        </div>
      </div>

      {/* SVG Canvas Scatter Visualizer */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
        <svg
          viewBox="0 0 500 240"
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'var(--terminal-bg)',
            borderRadius: '0.375rem',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {/* Coordinate Grid Crosshairs */}
          <line x1="250" y1="10" x2="250" y2="230" stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <line x1="10" y1="120" x2="490" y2="120" stroke="var(--border-subtle)" strokeDasharray="3 3" />

          {/* Normal Boundary Ring */}
          <circle cx="250" cy="120" r="85" fill="none" stroke="var(--border-strong)" strokeDasharray="4 4" opacity="0.5" />
          {/* Outlier Threshold Ring */}
          <circle cx="250" cy="120" r="140" fill="none" stroke="var(--warning-border)" strokeDasharray="4 4" opacity="0.3" />

          {/* Poisoning Subspace Region Indicator - conditionally rendered */}
          {poisonedCount > 0 && (
            <>
              <circle cx="410" cy="70" r="34" fill="var(--critical-surface)" stroke="var(--critical-border)" strokeDasharray="3 3" />
              <text x="410" y="30" fill="var(--critical-text)" fontSize="9" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">
                POISONED TRIGGER CLUSTER
              </text>
            </>
          )}

          {/* Points rendering */}
          {signalPoints.map(pt => {
            const isPoisoned = pt.status === 'poisoned';
            const isOod = pt.status === 'ood';
            const color = isPoisoned ? 'var(--critical)' : isOod ? 'var(--warning)' : 'var(--accent)';
            const r = isPoisoned ? 4.5 : isOod ? 3.5 : 2.5;

            return (
              <circle
                key={pt.id}
                cx={pt.x}
                cy={pt.y}
                r={r}
                fill={color}
                opacity={isPoisoned ? 0.95 : isOod ? 0.85 : 0.55}
                style={{
                  cursor: 'pointer',
                  transition: 'r 0.15s ease, opacity 0.15s ease',
                }}
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}
        </svg>

        {/* Hover Tooltip Card */}
        {hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              backgroundColor: 'var(--surface-elevated)',
              border: `1px solid ${
                hoveredPoint.status === 'poisoned'
                  ? 'var(--critical-border)'
                  : hoveredPoint.status === 'ood'
                  ? 'var(--warning-border)'
                  : 'var(--border)'
              }`,
              borderRadius: '0.375rem',
              padding: '8px 12px',
              pointerEvents: 'none',
              zIndex: 10,
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <strong className="font-mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{hoveredPoint.sampleId}</strong>
              <Badge
                variant={
                  hoveredPoint.status === 'poisoned'
                    ? 'critical'
                    : hoveredPoint.status === 'ood'
                    ? 'warning'
                    : 'accent'
                }
                size="sm"
              >
                {hoveredPoint.status}
              </Badge>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Anomaly score: <strong className="font-mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{hoveredPoint.score.toFixed(3)}</strong>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
              Subspace: {hoveredPoint.cluster}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
