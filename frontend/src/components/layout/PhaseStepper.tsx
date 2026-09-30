import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { Phase } from '../../types/investigation';

export const PhaseStepper: React.FC = () => {
  const { phase, setPhase, isScanning } = useInvestigation();

  const steps: { id: Phase; stepNum: string; label: string; desc: string }[] = [
    {
      id: 'launch',
      stepNum: '01',
      label: 'Launch & Upload',
      desc: 'Dataset & model ingestion',
    },
    {
      id: 'scan',
      stepNum: '02',
      label: 'Scan & Analyze',
      desc: '13-stage forensic pipeline',
    },
    {
      id: 'results',
      stepNum: '03',
      label: 'Results & Evidence',
      desc: 'Verdict, findings & lineage',
    },
  ];

  const getStepStatus = (stepId: Phase) => {
    if (stepId === phase) return 'active';
    if (stepId === 'launch' && (phase === 'scan' || phase === 'results')) return 'completed';
    if (stepId === 'scan' && phase === 'results') return 'completed';
    return 'upcoming';
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
        marginBottom: '24px',
      }}
    >
      {steps.map(step => {
        const status = getStepStatus(step.id);
        const isActive = status === 'active';
        const isCompleted = status === 'completed';

        return (
          <div
            key={step.id}
            onClick={() => setPhase(step.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') setPhase(step.id);
            }}
            style={{
              padding: '12px 20px',
              backgroundColor: isActive ? 'var(--surface)' : 'transparent',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: isActive ? 'var(--border-strong)' : 'transparent',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              transition: 'border-color 0.15s ease, background-color 0.15s ease',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.borderColor = 'var(--border)';
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: isActive ? 'var(--accent-text)' : 'var(--text-muted)',
                  }}
                >
                  {step.stepNum}
                </span>
                <span
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {step.label}
                </span>
              </div>
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  margin: 0,
                  marginTop: '2px',
                }}
              >
                {step.desc}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center' }}>
              {isCompleted ? (
                <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
              ) : isActive ? (
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: isScanning ? 'var(--accent)' : 'var(--border-strong)',
                    display: 'inline-block',
                  }}
                />
              ) : (
                <span
                  className="font-mono"
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {step.stepNum}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
