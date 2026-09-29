import React from 'react';
import { CheckCircle2, LockKeyhole, ShieldAlert, ShieldCheck, ChevronDown, Copy } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { ImageAssessment } from '../../services/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const resultColor = (result: ImageAssessment['result']) => {
  if (result === 'POISONED / ALTERED') return 'var(--critical-text)';
  if (result === 'SUSPICIOUS') return 'var(--warning-text)';
  if (result === 'NEAR-DUPLICATE') return 'var(--info-text, #6ea8fe)';
  return 'var(--success-text)';
};

const resultIcon = (result: ImageAssessment['result']) => {
  if (result === 'NEAR-DUPLICATE') return <Copy size={14} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />;
  return null;
};

const MAX_VISIBLE_EVIDENCE = 3;
const CARD_MAX_HEIGHT = 520;

export const ImageAssessments: React.FC = () => {
  const { imageResults, quarantineImage } = useInvestigation();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  if (!imageResults.length) return null;

  const handleQuarantine = async (image: ImageAssessment) => {
    setBusy(image.sample_id);
    try {
      await quarantineImage(image.sample_id);
    } finally {
      setBusy(null);
    }
  };

  const toggleExpand = (sampleId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sampleId)) next.delete(sampleId);
      else next.add(sampleId);
      return next;
    });
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>Per-Image Trust Assessments</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '12px' }}>
          Individual sample integrity verdicts (independent of the multi-layer system assurance score above).
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {imageResults.map(image => {
          const isExpanded = expanded.has(image.sample_id);
          const evidenceLines = image.evidence?.length ? image.evidence : [];
          const fullEvidence = image.evidence_full?.length ? image.evidence_full : evidenceLines;
          const hasMore = fullEvidence.length > MAX_VISIBLE_EVIDENCE;
          const visibleEvidence = isExpanded ? fullEvidence : evidenceLines.slice(0, MAX_VISIBLE_EVIDENCE);
          const triggerPatches = image.trigger_patches || [];

          return (
            <article
              key={image.sample_id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                overflow: 'hidden',
                height: CARD_MAX_HEIGHT,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {image.preview_data_url ? (
                <img
                  src={image.preview_data_url}
                  alt={image.file_name}
                  style={{
                    width: '100%',
                    height: 160,
                    objectFit: 'contain',
                    background: 'var(--surface-elevated)',
                    flexShrink: 0,
                    borderBottom: '1px solid var(--border)',
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 160,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-muted)',
                    background: 'var(--surface-elevated)',
                    flexShrink: 0,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  Preview unavailable
                </div>
              )}
              <div
                style={{
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{image.file_name}</strong>
                <div style={{ color: resultColor(image.result), fontWeight: 500 }}>
                  {resultIcon(image.result)}{image.result}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Badge variant={image.integrity_status === 'PASS' ? 'success' : 'critical'} size="sm" icon={image.integrity_status === 'PASS' ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}>
                    Integrity: {image.integrity_status}
                  </Badge>
                  <Badge variant={image.trust_status === 'VERIFIED' ? 'success' : 'warning'} size="sm" icon={<ShieldCheck size={12} />}>
                    Trust: {image.trust_status}
                  </Badge>
                </div>

                {/* Evidence Summary — always visible */}
                {image.evidence_summary && (
                  <div
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      padding: '6px 8px',
                      background: 'var(--surface-elevated)',
                      borderRadius: '6px',
                      borderLeft: `3px solid ${resultColor(image.result)}`,
                    }}
                  >
                    {image.evidence_summary}
                  </div>
                )}

                {/* Trigger patch locations */}
                {triggerPatches.length > 0 && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--critical-text)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {(isExpanded ? triggerPatches : triggerPatches.slice(0, 3)).map((tp, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldAlert size={12} style={{ flexShrink: 0 }} />
                        <span>
                          Trigger patch{tp.corner ? ` at ${tp.corner.replace('_', '-')}` : tp.region ? ` in ${tp.region}` : ''}
                          {tp.coordinates && ` [${tp.coordinates.join(', ')}]`}
                          {tp.patch_size && ` (${tp.patch_size}×${tp.patch_size})`}
                        </span>
                      </div>
                    ))}
                    {!isExpanded && triggerPatches.length > 3 && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 16 }}>
                        +{triggerPatches.length - 3} more suspicious patch locations
                      </span>
                    )}
                  </div>
                )}

                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }} className="font-mono">
                  Trust fingerprint<br />SHA-256: {image.sha256_hash}
                </div>
                {image.anomaly_score !== null && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Measured anomaly score: {image.anomaly_score.toFixed(3)}
                  </div>
                )}

                {/* Evidence lines — capped to 3, with expandable detail */}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Evidence:</strong>
                  {visibleEvidence.length === 0 ? (
                    <span> No integrity anomaly detected.</span>
                  ) : (
                    <ul style={{ margin: '4px 0 0', paddingLeft: '1.2em', listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {visibleEvidence.map((line, i) => (
                        <li key={i} style={{ overflowWrap: 'anywhere' }}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Show full evidence expander */}
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(image.sample_id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--accent-text, #58a6ff)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      padding: '2px 0',
                      fontFamily: 'inherit',
                      alignSelf: 'flex-start',
                    }}
                  >
                    <ChevronDown size={13} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    {isExpanded ? 'Hide full evidence' : `Show full evidence (${fullEvidence.length - MAX_VISIBLE_EVIDENCE} more)`}
                  </button>
                )}

                <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
                  {image.quarantined ? (
                    <div style={{ color: 'var(--critical-text)', fontWeight: 500 }}>
                      <LockKeyhole size={15} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      QUARANTINED
                      <br />
                      <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>Status: BLOCKED | Trust: REVOKED</span>
                    </div>
                  ) : image.action === 'QUARANTINE' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleQuarantine(image)}
                      disabled={busy === image.sample_id}
                      icon={<LockKeyhole size={14} strokeWidth={1.5} />}
                    >
                      {busy === image.sample_id ? 'Quarantining…' : 'Quarantine'}
                    </Button>
                  ) : (
                    <div style={{ color: 'var(--success-text)', fontSize: '0.8rem' }}>Action: Allowed after verification</div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
