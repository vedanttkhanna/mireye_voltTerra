export function formatRatio(ratio) {
  return ratio == null ? '—' : ratio.toFixed(1);
}

export function formatNumber(n) {
  return n == null ? '—' : n.toLocaleString();
}

export function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

export function formatBucket(bucket) {
  if (bucket === 'fund_charger_now') return 'Fund charger now';
  if (bucket === 'fund_grid_upgrade_first') return 'Fund grid upgrade first';
  return 'Not flagged';
}

export function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
