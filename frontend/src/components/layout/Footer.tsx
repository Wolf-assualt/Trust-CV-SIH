import React from 'react';
import { Lock, Cpu, Check } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderTop: '1px solid var(--border)',
        padding: '0.75rem 2rem',
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Lock size={13} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Unclassified — defense assurance use only
          </span>
        </div>
        <span style={{ color: 'var(--border-strong)', fontSize: '12px' }}>·</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Check size={13} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Hash continuity: continuous Merkle seal
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Cpu size={13} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Hardware SHA-256 acceleration active
          </span>
        </div>
        <span style={{ color: 'var(--border-strong)', fontSize: '12px' }}>·</span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          TRUST-CV v2.4 (offline SOC defense)
        </span>
      </div>
    </footer>
  );
};
