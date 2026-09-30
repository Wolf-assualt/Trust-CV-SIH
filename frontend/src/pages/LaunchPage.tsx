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
      style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}
    >
      <motion.section variants={sectionVariants}>
        <HeroSection />
      </motion.section>

      <motion.section variants={sectionVariants}>
        <div className="section-head">
          <span className="eyebrow">Ingestion</span>
          <h2 className="section-head__title">
            Real-Time Surveillance Stream & Forensic Ingestion
          </h2>
          <p className="section-head__sub">
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
        <div className="section-head">
          <span className="eyebrow">Benchmarks</span>
          <h2 className="section-head__title">System Performance</h2>
          <p className="section-head__sub">
            Benchmark measurements from the verification harness.
          </p>
        </div>
        <LatencyHistogram />
      </motion.section>
    </motion.div>
  );
};
