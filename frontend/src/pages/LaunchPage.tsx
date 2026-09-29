import React from 'react';
import { motion } from 'framer-motion';
import { HeroSection } from '../components/launch/HeroSection';
import { ArtifactUploader } from '../components/launch/ArtifactUploader';
import { ValidationChecklist } from '../components/launch/ValidationChecklist';
import { LatencyHistogram } from '../components/launch/LatencyHistogram';

const sectionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export const LaunchPage: React.FC = () => {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
      style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}
    >
      <motion.section variants={sectionVariants}>
        <HeroSection />
      </motion.section>

      <motion.section variants={sectionVariants}>
        <div style={{ marginBottom: '16px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Real-Time Surveillance Stream & Forensic Ingestion
          </h2>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              margin: '4px 0 0 0',
            }}
          >
            Continuous live camera feed monitoring, zero-trust frame verification, and forensic artifact ingestion.
          </p>
        </div>

        <ArtifactUploader />
      </motion.section>

      <motion.section variants={sectionVariants}>
        <ValidationChecklist />
      </motion.section>

      {/* Subdued system performance strip — benchmark presentation data only */}
      <motion.section variants={sectionVariants}>
        <div style={{ marginBottom: '16px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            System Performance
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Benchmark measurements from the verification harness.
          </p>
        </div>
        <LatencyHistogram />
      </motion.section>
    </motion.div>
  );
};
