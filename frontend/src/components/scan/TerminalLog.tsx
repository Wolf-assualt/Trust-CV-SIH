import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ArrowDown } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { TerminalLog as LogType } from '../../types/investigation';

export const TerminalLog: React.FC = () => {
  const { terminalLogs } = useInvestigation();
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'CRIT' | 'PASS'>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, autoScroll]);

  const filteredLogs = terminalLogs.filter(log => {
    if (filterLevel === 'ALL') return true;
    return log.level === filterLevel;
  });

  const getLevelBadge = (level: LogType['level']) => {
    const color =
      level === 'CRIT'
        ? 'var(--critical-text)'
        : level === 'WARN'
        ? 'var(--warning-text)'
        : level === 'PASS'
        ? 'var(--success-text)'
        : 'var(--terminal-muted)';
    return (
      <span
        style={{
          color,
          fontSize: '10px',
          fontWeight: 600,
          minWidth: '34px',
          display: 'inline-block',
        }}
      >
        {level}
      </span>
    );
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--terminal-bg)',
        border: '1px solid var(--terminal-border)',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '380px',
      }}
    >
      {/* Terminal Title Bar */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--terminal-surface)',
          borderBottom: '1px solid var(--terminal-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={14} strokeWidth={1.5} style={{ color: 'var(--terminal-muted)' }} />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--terminal-text)',
            }}
          >
            Live Forensic Audit Telemetry Stream
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: '11px',
              color: 'var(--terminal-muted)',
            }}
          >
            ({terminalLogs.length} events)
          </span>
        </div>

        {/* Level Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {(['ALL', 'CRIT', 'WARN', 'PASS', 'INFO'] as const).map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilterLevel(lvl)}
              style={{
                padding: '0.15rem 0.5rem',
                fontSize: '11px',
                border: '1px solid',
                borderColor: filterLevel === lvl ? 'var(--terminal-accent-border)' : 'var(--terminal-border)',
                backgroundColor: filterLevel === lvl ? 'var(--terminal-accent-surface)' : 'transparent',
                color: filterLevel === lvl ? 'var(--terminal-accent-text)' : 'var(--terminal-text)',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              className="font-mono"
            >
              {lvl}
            </button>
          ))}

          <button
            onClick={() => setAutoScroll(prev => !prev)}
            style={{
              padding: '0.15rem 0.5rem',
              fontSize: '11px',
              border: '1px solid var(--terminal-border)',
              backgroundColor: autoScroll ? 'var(--terminal-surface-active)' : 'transparent',
              color: autoScroll ? 'var(--terminal-text)' : 'var(--terminal-muted)',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Toggle Auto-Scroll"
          >
            <ArrowDown size={10} strokeWidth={1.5} />
            AUTO
          </button>
        </div>
      </div>

      {/* Log Feed */}
      <div
        style={{
          padding: '12px 16px',
          overflowY: 'auto',
          flex: 1,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
          lineHeight: '1.6',
          color: 'var(--terminal-text)',
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: 'var(--terminal-muted)', padding: '16px 0' }}>
            Awaiting kernel initialization events...
          </div>
        ) : (
          filteredLogs.map(log => (
            <div
              key={log.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginBottom: '4px',
              }}
            >
              <span style={{ color: 'var(--terminal-muted)', userSelect: 'none', minWidth: '65px' }}>
                [{log.timestamp.includes('T') ? log.timestamp.split('T')[1].slice(0, 8) : log.timestamp}]
              </span>
              {getLevelBadge(log.level)}
              <span
                style={{
                  color:
                    log.level === 'CRIT'
                      ? 'var(--critical-text)'
                      : log.level === 'WARN'
                      ? 'var(--warning-text)'
                      : log.level === 'PASS'
                      ? 'var(--success-text)'
                      : 'var(--terminal-text)',
                }}
              >
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};
