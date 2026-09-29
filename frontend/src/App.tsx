import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { InvestigationProvider, useInvestigation } from './state/investigationStore';
import { Header } from './components/layout/Header';
import { PhaseStepper } from './components/layout/PhaseStepper';
import { LaunchPage } from './pages/LaunchPage';
import { ScanPage } from './pages/ScanPage';
import { ResultsPage } from './pages/ResultsPage';
import './theme/globals.css';

const MultiPhaseSocView: React.FC = () => {
  const { phase } = useInvestigation();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Header />
      <PhaseStepper />

      <main style={{ flex: 1, width: '100%', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: '1680px', margin: '0 auto', minHeight: '100%', padding: '0 1.5rem 3rem' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {phase === 'launch' && <LaunchPage />}
              {phase === 'scan' && <ScanPage />}
              {phase === 'results' && <ResultsPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <InvestigationProvider>
      <MultiPhaseSocView />
    </InvestigationProvider>
  );
}
