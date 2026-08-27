import { formatBucket } from '../utils/format.js';

const STYLES = {
  fund_charger_now: {
    background: 'var(--accent-light, #ecfdf5)',
    color: 'var(--accent-darker, #065f46)',
    border: '1px solid var(--accent-border, #a7f3d0)',
  },
  fund_grid_upgrade_first: {
    background: 'var(--danger-light, #fef2f2)',
    color: '#b91c1c',
    border: '1px solid #fecaca',
  },
  insufficient_data: {
    background: '#f1f5f9',
    color: '#475569',
    border: '1px solid #94a3b8',
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
