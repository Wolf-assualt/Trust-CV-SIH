import React from 'react';
import { Lock, Cpu, Check } from 'lucide-react';

/**
 * Footer — three quiet columns of tiny uppercase mono metadata. No fill
 * beyond the page background: a hairline on top is the only separator.
 */
export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="footer__col">
        <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Unclassified — defense assurance use only</span>
      </div>

      <div className="footer__col">
        <Check size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Hash continuity: continuous Merkle seal</span>
      </div>

      <div className="footer__col footer__col--end">
        <Cpu size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Hardware SHA-256 acceleration active</span>
        <span className="footer__rule" aria-hidden="true" />
        <span>TRUST-CV v2.4 (offline SOC defense)</span>
      </div>
    </footer>
  );
};
