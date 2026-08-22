import { useMemo, useState } from 'react';
import BucketBadge from './BucketBadge.jsx';
import { formatNumber, formatRatio } from '../utils/format.js';

const FILTERS = [
  { key: 'all', label: 'All counties' },
  { key: 'underserved', label: 'Underserved only' },
  { key: 'fund_charger_now', label: 'Fund charger now' },
  { key: 'fund_grid_upgrade_first', label: 'Fund grid upgrade first' },
  { key: 'insufficient_data', label: 'Needs data review' },
];

export default function RankedTable({ counties, selectedFips, onSelect }) {
  const [filter, setFilter] = useState('underserved');

  const rows = useMemo(() => {
    if (filter === 'all') return counties;
    if (filter === 'underserved') return counties.filter((c) => c.underserved);
    return counties.filter((c) => c.bucket === filter);
  }, [counties, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              border: '1px solid #2a3548',
              background: filter === f.key ? '#1c2536' : 'transparent',
              color: filter === f.key ? '#e6edf3' : '#8899aa',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#8899aa', borderBottom: '1px solid #2a3548' }}>
              <th style={{ padding: '0.5rem' }}>County</th>
              <th style={{ padding: '0.5rem' }}>EVs / port</th>
              <th style={{ padding: '0.5rem' }}>Registrations</th>
              <th style={{ padding: '0.5rem' }}>Ports</th>
              <th style={{ padding: '0.5rem' }}>Bucket</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.county_fips}
                onClick={() => onSelect(c.county_fips)}
                style={{
                  cursor: 'pointer',
                  borderBottom: '1px solid #1c2536',
                  background: selectedFips === c.county_fips ? '#141c2b' : 'transparent',
                }}
              >
                <td style={{ padding: '0.5rem', fontWeight: 500 }}>{c.county_name}</td>
                <td style={{ padding: '0.5rem' }}>{c.zero_charging_ports ? 'No ports' : formatRatio(c.driver_to_plug_ratio)}</td>
                <td style={{ padding: '0.5rem' }}>{formatNumber(c.latest_registrations)}</td>
                <td style={{ padding: '0.5rem' }}>{formatNumber(c.charger_count)}</td>
                <td style={{ padding: '0.5rem' }}>
                  <BucketBadge bucket={c.bucket} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '1rem', color: '#8899aa', textAlign: 'center' }}>
                  No counties match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
