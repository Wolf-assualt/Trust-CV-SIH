import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { Phase } from '../../types/investigation';

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

export const PhaseStepper: React.FC = () => {
  const { phase, setPhase, isScanning } = useInvestigation();

  const getStepStatus = (stepId: Phase) => {
    if (stepId === phase) return 'active';
    if (stepId === 'launch' && (phase === 'scan' || phase === 'results')) return 'completed';
    if (stepId === 'scan' && phase === 'results') return 'completed';
    return 'upcoming';
  };

  return (
    <div className="segmented" style={{ marginBottom: 'var(--s-6)' }}>
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
            className={`segmented__tab${isActive ? ' segmented__tab--active' : ''}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="segmented__num">{step.stepNum}</span>

            <span className="segmented__body">
              <span className="segmented__label">{step.label}</span>
              <span className="segmented__desc">{step.desc}</span>
            </span>

            {isCompleted ? (
              <CheckCircle2 size={15} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
            ) : isActive ? (
              <span
                className="status-dot"
                style={{
                  backgroundColor: isScanning ? 'var(--accent-text)' : 'var(--border-strong)',
                }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};