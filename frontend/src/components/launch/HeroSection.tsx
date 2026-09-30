import React from 'react';
import { Database, Cpu, Binary, ShieldCheck } from 'lucide-react';

interface HeroPill {
  id: string;
  icon: React.ReactNode;
  label: string;
}

const HERO_PILLS: HeroPill[] = [
  {
    id: 'art-dataset',
    icon: <Database size={15} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />,
    label: 'Dataset Poisoning & OOD',
  },
  {
    id: 'art-model',
    icon: <Cpu size={15} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />,
    label: 'Weight Hash Verification',
  },
  {
    id: 'art-inference',
    icon: <Binary size={15} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />,
    label: 'Inference Anomaly Probe',
  },
  {
    id: 'art-manifest',
    icon: <ShieldCheck size={15} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />,
    label: 'Directed Evidence Graph',
  },
];

const scrollToArtifact = (artifactId: string) => {
  document.getElementById(`artifact-card-${artifactId}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
};

export const HeroSection: React.FC = () => {
  return (
    <section
      style={{
        padding: '48px 0 32px 0',
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative' }}>
        <h1
          style={{
            fontSize: '2.25rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
            marginBottom: '12px',
          }}
        >
          Establish Trust Before Inference.
        </h1>

        <p
          style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
            maxWidth: '720px',
            margin: '0 auto 32px auto',
            lineHeight: 1.5,
          }}
        >
          Inspect computer-vision datasets, neural network weights, and inference outputs for
          clean-label poisoning, trigger backdoors, adversarial tampering, and evidence-chain inconsistencies
          before deployment to mission-critical systems.
        </p>

        {/* Static benchmark metrics — 24px semibold numbers, quiet labels below */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '48px',
            marginBottom: '32px',
          }}
        >
          {[
            { label: 'Forensic pipeline stages', value: '13' },
            { label: 'P95 verify latency', value: '29.28ms' },
            { label: 'Air-gap capable', value: '100%' },
          ].map(metric => (
            <div key={metric.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span
                style={{
                  fontSize: '24px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {metric.value}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {metric.label}
              </span>
            </div>
          ))}
        </div>

        {/* Capability pills — click scrolls to the matching artifact card */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {HERO_PILLS.map(pill => (
            <button
              key={pill.id}
              onClick={() => scrollToArtifact(pill.id)}
              className="hero-pill"
              aria-label={`Jump to ${pill.label} artifact`}
            >
              {pill.icon}
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                {pill.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
