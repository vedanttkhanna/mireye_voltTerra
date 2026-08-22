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
  const [hoverFips, setHoverFips] = useState(null);

  const rows = useMemo(() => {
    if (filter === 'all') return counties;
    if (filter === 'underserved') return counties.filter((c) => c.underserved);
    return counties.filter((c) => c.bucket === filter);
  }, [counties, filter]);

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: 6,
                border: isActive ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                background: isActive ? 'var(--accent-light)' : '#ffffff',
                color: isActive ? 'var(--accent-darker)' : 'var(--fg-muted)',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.15s ease',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '2px solid var(--card-border)' }}>
              <th style={{ padding: '0.65rem 0.75rem', fontWeight: 600 }}>County</th>
              <th style={{ padding: '0.65rem 0.75rem', fontWeight: 600 }}>EVs / port</th>
              <th style={{ padding: '0.65rem 0.75rem', fontWeight: 600 }}>Registrations</th>
              <th style={{ padding: '0.65rem 0.75rem', fontWeight: 600 }}>Ports</th>
              <th style={{ padding: '0.65rem 0.75rem', fontWeight: 600 }}>Bucket</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isSelected = selectedFips === c.county_fips;
              const isHovered = hoverFips === c.county_fips;
              let rowBg = 'transparent';
              if (isSelected) rowBg = 'var(--accent-light, #ecfdf5)';
              else if (isHovered) rowBg = '#f8fafc';

              return (
                <tr
                  key={c.county_fips}
                  onClick={() => onSelect(c.county_fips)}
                  onMouseEnter={() => setHoverFips(c.county_fips)}
                  onMouseLeave={() => setHoverFips(null)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--card-border)',
                    background: rowBg,
                    transition: 'background-color 0.1s ease',
                  }}
                >
                  <td style={{ padding: '0.75rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? 'var(--accent-darker)' : 'var(--fg)' }}>
                    {c.county_name}
                  </td>
                  <td style={{ padding: '0.75rem', fontWeight: 600 }}>{formatRatio(c.driver_to_plug_ratio)}</td>
                  <td style={{ padding: '0.75rem', color: 'var(--fg-muted)' }}>{formatNumber(c.latest_registrations)}</td>
                  <td style={{ padding: '0.75rem', color: 'var(--fg-muted)' }}>{formatNumber(c.charger_count)}</td>
                  <td style={{ padding: '0.75rem' }}>
                    <BucketBadge bucket={c.bucket} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', color: 'var(--fg-muted)', textAlign: 'center' }}>
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
