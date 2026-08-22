import { formatBucket } from '../utils/format.js';

const STYLES = {
  fund_charger_now: {
    background: 'var(--accent-light, #ecfdf5)',
    color: 'var(--accent-darker, #065f46)',
    border: '1px solid var(--accent-border, #a7f3d0)',
  },
  fund_grid_upgrade_first: {
    background: 'var(--warn-light, #fffbeb)',
    color: 'var(--warn-dark, #b45309)',
    border: '1px solid var(--warn-border, #fde68a)',
  },
  not_flagged: {
    background: '#f1f5f9',
    color: '#64748b',
    border: '1px solid #e2e8f0',
  },
};

export default function BucketBadge({ bucket }) {
  const style = STYLES[bucket ?? 'not_flagged'];
  return (
    <span
      style={{
        ...style,
        padding: '0.2rem 0.65rem',
        borderRadius: '999px',
        fontSize: '0.78rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {formatBucket(bucket)}
    </span>
  );
}
