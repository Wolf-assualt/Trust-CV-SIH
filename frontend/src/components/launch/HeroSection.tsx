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
        <p className="eyebrow" style={{ marginBottom: 'var(--s-3)' }}>
          Zero-Trust Computer Vision
        </p>

        <h1 className="hero-title">Establish Trust Before{' '}
          <span className="accent-word">Inference.</span>
        </h1>

        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            maxWidth: '640px',
            margin: '0 auto 32px auto',
            lineHeight: 1.6,
          }}
        >
          Inspect computer-vision datasets, neural network weights, and inference outputs for
          clean-label poisoning, trigger backdoors, adversarial tampering, and evidence-chain inconsistencies
          before deployment to mission-critical systems.
        </p>

        {/* Static benchmark metrics — three equal bordered stat cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 'var(--s-4)',
            maxWidth: '720px',
            margin: '0 auto 32px',
            textAlign: 'left',
          }}
        >
          {[
            { label: 'Pipeline stages', value: '13', unit: '' },
            { label: 'P95 latency', value: '29.28', unit: 'ms' },
            { label: 'Air-gap capable', value: '100', unit: '%' },
          ].map(metric => (
            <div key={metric.label} className="stat-card">
              <span className="stat-card__label">{metric.label}</span>
              <span className="stat-card__value">
                {metric.value}
                {metric.unit && <span className="stat-card__unit">{metric.unit}</span>}
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
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                }}
              >
                {pill.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
