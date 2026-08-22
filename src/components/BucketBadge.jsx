import { formatBucket } from '../utils/format.js';

const STYLES = {
  fund_charger_now: { background: '#00e67622', color: '#00e676', border: '1px solid #00e67655' },
  fund_grid_upgrade_first: { background: '#ffab0022', color: '#ffab00', border: '1px solid #ffab0055' },
  not_flagged: { background: '#8899aa22', color: '#8899aa', border: '1px solid #8899aa33' },
};

export default function BucketBadge({ bucket }) {
  const style = STYLES[bucket ?? 'not_flagged'];
  return (
    <span
      style={{
        ...style,
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.8rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {formatBucket(bucket)}
    </span>
  );
}
