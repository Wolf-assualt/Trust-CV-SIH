import React from 'react';
import { ShieldAlert, Sun, Moon, Command } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import { BackendStatus } from '../ui/BackendStatus';
import { CommandPalette } from '../ui/CommandPalette';

export const Header: React.FC = () => {
  const { phase, setPhase, theme, toggleTheme, sessionId, isScanning, backendOnline } = useInvestigation();

  const navItems: Array<{ id: 'launch' | 'scan' | 'results'; num: string; label: string }> = [
    { id: 'launch', num: '01', label: 'Launch' },
    { id: 'scan', num: '02', label: 'Scan' },
    { id: 'results', num: '03', label: 'Results' },
  ];

  return (
    <header
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
        padding: '0.75rem 2rem',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '24px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '0.5rem',
            backgroundColor: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            flexShrink: 0,
          }}
        >
          <ShieldAlert size={16} strokeWidth={1.5} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              TRUST-CV
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: '999px',
                padding: '1px 8px',
              }}
            >
              SOC
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              {sessionId}
            </span>
          </div>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            Zero-Trust Computer Vision Integrity Assurance & Forensic Platform
          </p>
        </div>
      </div>

      {/* Center: Phase Navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '2px',
          gap: '2px',
        }}
      >
        {navItems.map((item, i) => (
          <React.Fragment key={item.id}>
            {i > 0 && <span style={{ color: 'var(--border-strong)', fontSize: '12px' }}>/</span>}
            <button
              onClick={() => setPhase(item.id)}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: '0.375rem',
                border: 'none',
                fontSize: '0.8125rem',
                fontWeight: phase === item.id ? 500 : 400,
                backgroundColor: phase === item.id ? 'var(--accent-surface)' : 'transparent',
                color: phase === item.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'color 0.15s ease, background-color 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ opacity: 0.5 }} className="font-mono">{item.num}</span> {item.label}
              {item.id === 'scan' && isScanning && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--accent)',
                    display: 'inline-block',
                  }}
                />
              )}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <BackendStatus online={backendOnline} />

        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="ctl-pill"
          aria-label="Open command palette"
          title="Open command palette (⌘K)"
        >
          <span className="ctl-pill__icon">
            <Command size={14} strokeWidth={1.75} />
          </span>
          <span className="ctl-pill__label">Search</span>
          <span className="ctl-kbd">⌘K</span>
        </button>

        <button
          onClick={toggleTheme}
          className="ctl-pill ctl-pill--theme"
          aria-label="Toggle Light and Dark Theme"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="ctl-pill__icon">
            {theme === 'dark' ? (
              <Sun size={14} strokeWidth={1.75} />
            ) : (
              <Moon size={14} strokeWidth={1.75} />
            )}
          </span>
          <span className="ctl-pill__label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>

      {/* Global command palette (⌘K / Ctrl+K) */}
      <CommandPalette />
    </header>
  );
};
