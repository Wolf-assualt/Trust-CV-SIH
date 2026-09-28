/**
 * Status normalization utility for Trust-CV frontend.
 *
 * Maps the raw backend `properties.status` string (or node_type-derived
 * implicit status) to one of four display categories used for colouring,
 * halos, and particle speed.
 *
 * Backend statuses observed in schemas/base.py  (AssetStatus enum) and
 * in the graph node properties populated by graph/engine.py:
 *   ACCEPTED, UNDER_REVIEW, QUARANTINED, REJECTED
 *
 * Additional ad-hoc strings that backend evidence/findings may carry:
 *   VERIFIED, PASS, TAMPERED, FAILED, REVIEW, DRIFT, UNKNOWN,
 *   SEALED, AUTHENTICATED, CLEAN, POISONED, REVOKED, MISMATCH,
 *   severity values: CRITICAL, HIGH, MEDIUM, LOW, INFO
 */

export type NormalizedStatus = 'normal' | 'warning' | 'critical' | 'unknown';

const CRITICAL_PATTERNS = [
  'QUARANTINED', 'REJECTED', 'TAMPERED', 'FAILED', 'REVOKED',
  'POISONED', 'MISMATCH', 'CRITICAL', 'HIGH', 'HARD_VETO', 'VETO',
] as const;

const WARNING_PATTERNS = [
  'UNDER_REVIEW', 'REVIEW', 'DRIFT', 'WARNING', 'MEDIUM', 'FLAGGED',
] as const;

const NORMAL_PATTERNS = [
  'ACCEPTED', 'VERIFIED', 'PASS', 'SEALED', 'AUTHENTICATED', 'CLEAN',
  'LOW', 'INFO', 'NORMAL',
] as const;

/**
 * Normalize an arbitrary backend status string to a frontend display category.
 *
 * Rules (evaluated top-to-bottom, first match wins):
 * 1. Null / empty / "UNKNOWN" → 'unknown'
 * 2. Contains any critical keyword → 'critical'
 * 3. Contains any warning keyword → 'warning'
 * 4. Contains any normal keyword → 'normal'
 * 5. Anything else → 'unknown'
 *
 * Unknown always renders neutral gray — never green.
 */
export function normalizeStatus(raw: string | null | undefined): NormalizedStatus {
  if (raw == null) return 'unknown';
  const upper = String(raw).trim().toUpperCase();
  if (!upper || upper === 'UNKNOWN') return 'unknown';

  for (const pat of CRITICAL_PATTERNS) {
    if (upper.includes(pat)) return 'critical';
  }
  for (const pat of WARNING_PATTERNS) {
    if (upper.includes(pat)) return 'warning';
  }
  for (const pat of NORMAL_PATTERNS) {
    if (upper.includes(pat)) return 'normal';
  }

  return 'unknown';
}

/**
 * Determine the edge visual category based on the source and target node
 * statuses. An edge originating from a critical node going to a downstream
 * non-critical node is "interrupted" (dashed amber, no particle).
 */
export type EdgeVisualCategory = 'normal' | 'warning' | 'critical' | 'interrupted';

export function edgeVisualCategory(
  sourceStatus: NormalizedStatus,
  targetStatus: NormalizedStatus,
): EdgeVisualCategory {
  if (sourceStatus === 'critical' && targetStatus !== 'critical') return 'interrupted';
  if (sourceStatus === 'critical' || targetStatus === 'critical') return 'critical';
  if (sourceStatus === 'warning' || targetStatus === 'warning') return 'warning';
  return 'normal';
}
