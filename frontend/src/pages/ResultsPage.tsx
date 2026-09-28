import React from 'react';
import { motion } from 'framer-motion';
import { useInvestigation } from '../state/investigationStore';
import { VerdictCard } from '../components/results/VerdictCard';
import { SummaryCards } from '../components/results/SummaryCards';
import { TrustScoreCard } from '../components/results/TrustScoreCard';
import { FindingsTable } from '../components/results/FindingsTable';
import { FindingDrawer } from '../components/results/FindingDrawer';
import { EvidenceGraph } from '../components/results/EvidenceGraph';
import { Recommendations } from '../components/results/Recommendations';
import { ExportActions } from '../components/results/ExportActions';
import { ImageAssessments } from '../components/results/ImageAssessments';
import { LedgerAuditPanel } from '../components/results/LedgerAuditPanel';
import { AnalystDecisionPanel } from '../components/results/AnalystDecisionPanel';
import { BackendErrorBanner } from '../components/results/BackendErrorBanner';
import { EmptyState } from '../components/ui/EmptyState';

const sectionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export const ResultsPage: React.FC = () => {
  const { scanSession, trustScore, isScanCompleted, currentScanId } = useInvestigation();
  const hasRunScan = Boolean(scanSession || trustScore || isScanCompleted);

  if (!hasRunScan) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <EmptyState
          title="No Forensic Scan Has Run Yet"
          description="Results will appear here once the backend assurance pipeline has processed a dataset. Head back to Launch, upload a computer-vision dataset, and let the 13-stage zero-trust pipeline produce an authoritative verdict."
        />
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
      style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}
    >
      <motion.section variants={sectionVariants}>
        {/* Backend failures/partial states are surfaced, never hidden. */}
        <BackendErrorBanner />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 1. Large Verdict Card */}
        <VerdictCard />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 2. Executive Summary Metrics */}
        <SummaryCards />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 3. Trust Score Breakdown */}
        <TrustScoreCard />
      </motion.section>

      <motion.section variants={sectionVariants}>
        <ImageAssessments />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 4. Forensic Findings Table */}
        <FindingsTable />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 5. Directed Evidence & Lineage Graph */}
        <EvidenceGraph key={currentScanId || 'empty-scan'} />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 6. Tamper-Evident Ledger Verification (backend authoritative) */}
        <LedgerAuditPanel />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 7. Analyst disposition — separate from the system assessment */}
        <AnalystDecisionPanel />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 8. Actionable Recommendations */}
        <Recommendations />
      </motion.section>

      <motion.section variants={sectionVariants}>
        {/* 9. Export & Workflow Actions */}
        <ExportActions />
      </motion.section>

      {/* Modal Drawer for clicked finding */}
      <FindingDrawer />
    </motion.div>
  );
};
