import { describe, it, expect } from 'vitest';
import {
  normalizeStatus,
  edgeVisualCategory,
} from '../utils/statusNormalize';


/* ════════════════════════════════════════════════════════════════════════════
   normalizeStatus()
   ════════════════════════════════════════════════════════════════════════════ */

describe('normalizeStatus', () => {
  // ── Critical statuses ──────────────────────────────────────────────────
  it.each([
    'QUARANTINED',
    'REJECTED',
    'TAMPERED',
    'FAILED',
    'REVOKED',
    'POISONED',
    'MISMATCH',
    'CRITICAL',
    'HIGH',
    'HARD_VETO',
    'VETO',
  ])('maps "%s" to critical', (raw) => {
    expect(normalizeStatus(raw)).toBe('critical');
  });

  it('is case-insensitive for critical', () => {
    expect(normalizeStatus('quarantined')).toBe('critical');
    expect(normalizeStatus('Tampered')).toBe('critical');
  });

  // ── Warning statuses ───────────────────────────────────────────────────
  it.each([
    'UNDER_REVIEW',
    'REVIEW',
    'DRIFT',
    'WARNING',
    'MEDIUM',
    'FLAGGED',
  ])('maps "%s" to warning', (raw) => {
    expect(normalizeStatus(raw)).toBe('warning');
  });

  // ── Normal statuses ────────────────────────────────────────────────────
  it.each([
    'ACCEPTED',
    'VERIFIED',
    'PASS',
    'SEALED',
    'AUTHENTICATED',
    'CLEAN',
    'LOW',
    'INFO',
    'NORMAL',
  ])('maps "%s" to normal', (raw) => {
    expect(normalizeStatus(raw)).toBe('normal');
  });

  // ── Unknown / edge cases ───────────────────────────────────────────────
  it('maps null to unknown', () => {
    expect(normalizeStatus(null)).toBe('unknown');
  });

  it('maps undefined to unknown', () => {
    expect(normalizeStatus(undefined)).toBe('unknown');
  });

  it('maps empty string to unknown', () => {
    expect(normalizeStatus('')).toBe('unknown');
  });

  it('maps "UNKNOWN" to unknown', () => {
    expect(normalizeStatus('UNKNOWN')).toBe('unknown');
  });

  it('maps unrecognized strings to unknown', () => {
    expect(normalizeStatus('FOOBAR')).toBe('unknown');
  });

  it('maps whitespace-padded strings correctly', () => {
    expect(normalizeStatus('  VERIFIED  ')).toBe('normal');
    expect(normalizeStatus('  TAMPERED  ')).toBe('critical');
  });

  // ── Unknown never maps to green/normal ─────────────────────────────────
  it('unknown status is never "normal" (never green)', () => {
    const neutralInputs = [null, undefined, '', 'UNKNOWN', 'SOME_RANDOM_STATUS'];
    for (const input of neutralInputs) {
      const result = normalizeStatus(input);
      expect(result).not.toBe('normal');
    }
  });

  // ── Priority: critical wins over warning within compound strings ───────
  it('critical keyword takes priority over warning in compound status', () => {
    expect(normalizeStatus('QUARANTINED_REVIEW')).toBe('critical');
    expect(normalizeStatus('REVIEW_FAILED')).toBe('critical');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   edgeVisualCategory()
   ════════════════════════════════════════════════════════════════════════════ */

describe('edgeVisualCategory', () => {
  it('returns "interrupted" when source is critical and target is not', () => {
    expect(edgeVisualCategory('critical', 'normal')).toBe('interrupted');
    expect(edgeVisualCategory('critical', 'warning')).toBe('interrupted');
    expect(edgeVisualCategory('critical', 'unknown')).toBe('interrupted');
  });

  it('returns "critical" when both source and target are critical', () => {
    expect(edgeVisualCategory('critical', 'critical')).toBe('critical');
  });

  it('returns "warning" when source or target is warning (no critical)', () => {
    expect(edgeVisualCategory('warning', 'normal')).toBe('warning');
    expect(edgeVisualCategory('normal', 'warning')).toBe('warning');
  });

  it('returns "normal" when both are normal or unknown', () => {
    expect(edgeVisualCategory('normal', 'normal')).toBe('normal');
    expect(edgeVisualCategory('unknown', 'unknown')).toBe('normal');
    expect(edgeVisualCategory('normal', 'unknown')).toBe('normal');
  });
});
