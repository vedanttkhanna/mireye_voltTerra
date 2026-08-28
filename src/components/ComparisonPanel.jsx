import { useMemo, useState } from 'react';
import BucketBadge from './BucketBadge.jsx';
import { formatBucket, formatDistance, formatNumber, formatRatio } from '../utils/format.js';

const SOURCE_URLS = {
  afdc: 'https://afdc.energy.gov/data_download',
  census: 'https://www.census.gov/programs-surveys/acs',
  mireye: 'https://www.mireye.com',
};

function compact(value, suffix = '') {
  if (value == null || value === '') return 'Not available';
  return `${value}${suffix}`;
}

function SourceLinks({ sources }) {
  return (
    <span className="comparison-sources">
      {sources.map((source) => (
        <a
          key={`${source.label}-${source.href}`}
          className="comparison-source"
          href={source.href}
          target="_blank"
          rel="noreferrer"
        >
          {source.label} ↗
        </a>
      ))}
    </span>
  );
}

function Value({ children, tone }) {
  return <span className={`comparison-value${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

export default function ComparisonPanel({ counties, demandMetric, dataSources, selectedFips, onSelectCounty }) {
  const defaultIds = useMemo(() => {
    const ids = [];
    if (selectedFips && counties.some((county) => county.county_fips === selectedFips)) ids.push(selectedFips);
    for (const county of counties) {
      if (ids.length === 2) break;
      if (!ids.includes(county.county_fips)) ids.push(county.county_fips);
    }
    return ids;
  }, [counties, selectedFips]);
  const [selectedIds, setSelectedIds] = useState(defaultIds);

  const selected = selectedIds.map((id) => counties.find((county) => county.county_fips === id)).filter(Boolean);
  const usesPopulation = demandMetric === 'people_per_public_port';
  const demandLabel = usesPopulation ? 'People per public port' : 'EVs per public port';
  const volumeLabel = usesPopulation ? 'County population' : 'Registered EVs';
  const volumeSource = usesPopulation
    ? [{ label: dataSources?.county_population?.source || 'US Census ACS', href: dataSources?.county_population?.source_url || SOURCE_URLS.census }]
    : [{ label: dataSources?.ev_registrations?.source || 'EV registrations', href: dataSources?.ev_registrations?.source_url || SOURCE_URLS.census }];
  const supplySource = [{ label: dataSources?.charger_inventory?.source || 'DOE AFDC', href: dataSources?.charger_inventory?.source_url || SOURCE_URLS.afdc }];
  const gridSource = [{ label: dataSources?.grid_evidence?.source || 'Mireye live grid data', href: dataSources?.grid_evidence?.source_url || SOURCE_URLS.mireye }];
  const demandSources = [...volumeSource, ...supplySource];

  const highestDemand = selected.reduce((best, county) => (
    (county.driver_to_plug_ratio ?? -1) > (best?.driver_to_plug_ratio ?? -1) ? county : best
  ), null);
  const strongestGrid = selected.reduce((best, county) => (
    (county.grid_feasibility?.score ?? -1) > (best?.grid_feasibility?.score ?? -1) ? county : best
  ), null);

  const replaceCounty = (index, nextId) => {
    setSelectedIds((current) => {
      const duplicateAt = current.indexOf(nextId);
      const next = [...current];
      if (duplicateAt >= 0 && duplicateAt !== index) next[duplicateAt] = current[index];
      next[index] = nextId;
      return next;
    });
  };

  const addCounty = () => {
    const nextCounty = counties.find((county) => !selectedIds.includes(county.county_fips));
    if (nextCounty) setSelectedIds((current) => [...current, nextCounty.county_fips]);
  };

  const removeCounty = (countyFips) => {
    if (selectedIds.length <= 2) return;
    setSelectedIds((current) => current.filter((id) => id !== countyFips));
  };

  const rows = [
    {
      label: 'Funding priority', hint: 'Recommended next action', sources: demandSources.concat(gridSource),
      render: (county) => county.bucket ? <BucketBadge bucket={county.bucket} /> : <Value>Not flagged</Value>,
    },
    {
      label: demandLabel, hint: 'Higher means more demand pressure', sources: demandSources,
      render: (county) => <Value tone={county === highestDemand ? 'attention' : ''}>{county.no_public_charging ? 'No public ports' : formatRatio(county.driver_to_plug_ratio)}</Value>,
    },
    {
      label: volumeLabel, hint: usesPopulation ? 'Residents in the county' : 'Latest public registration count', sources: volumeSource,
      render: (county) => <Value>{formatNumber(usesPopulation ? county.population : county.latest_registrations)}</Value>,
    },
    {
      label: 'Public charging ports', hint: 'Level 2 and DC fast ports', sources: supplySource,
      render: (county) => <Value tone={county.charger_count === 0 ? 'attention' : ''}>{formatNumber(county.charger_count)}</Value>,
    },
    {
      label: 'Grid readiness', hint: 'Feasibility score out of 100', sources: gridSource,
      render: (county) => <Value tone={county === strongestGrid ? 'positive' : ''}>{county.grid_feasibility ? `${county.grid_feasibility.score}/100` : 'Not assessed'}</Value>,
    },
    {
      label: 'Nearest substation', hint: 'Distance from county population center', sources: gridSource,
      render: (county) => <Value>{formatDistance(county.grid_feasibility?.inputs?.substation_distance_m)}</Value>,
    },
    {
      label: 'Substation voltage', hint: '60 kV is the readiness gate', sources: gridSource,
      render: (county) => <Value>{compact(county.grid_feasibility?.inputs?.substation_voltage_kv, ' kV')}</Value>,
    },
    {
      label: 'Industrial electricity price', hint: 'Estimated operating-cost signal', sources: gridSource,
      render: (county) => <Value>{county.context?.electricity_price_usd_per_kwh == null ? 'Not available' : `$${Number(county.context.electricity_price_usd_per_kwh).toFixed(3)}/kWh`}</Value>,
    },
    {
      label: 'Utility territory', hint: 'Serving electric utility', sources: gridSource,
      render: (county) => <Value>{compact(county.context?.utility)}</Value>,
    },
    {
      label: 'Build access', hint: 'Terrain slope and nearest road class', sources: gridSource,
      render: (county) => <Value>{county.context?.slope_degrees == null ? compact(county.context?.road_class) : `${Number(county.context.slope_degrees).toFixed(1)}° slope · ${compact(county.context?.road_class)}`}</Value>,
    },
    {
      label: 'Siting risk', hint: 'Fire and flood screening', sources: gridSource,
      render: (county) => <Value>{`Fire: ${compact(county.context?.fire_hazard)} · Flood: ${compact(county.context?.flood_zone)}`}</Value>,
    },
  ];

  return (
    <div className="comparison-workspace">
      <div className="comparison-intro">
        <div>
          <p className="comparison-eyebrow">Side-by-side county evidence</p>
          <h2>Compare the signals that drive funding</h2>
          <p>Start with two counties and add as many as you need. Every row identifies its live source.</p>
        </div>
        <div className="comparison-summary">
          <div className="comparison-insights" aria-label="Comparison highlights">
            <div><span>Highest demand</span><strong>{highestDemand?.county_name || '—'}</strong></div>
            <div><span>Strongest grid</span><strong>{strongestGrid?.county_name || '—'}</strong></div>
          </div>
          <button
            className="comparison-add"
            type="button"
            onClick={addCounty}
            disabled={selectedIds.length === counties.length}
          >
            <span aria-hidden="true">＋</span> Add county
          </button>
        </div>
      </div>

      <div className="comparison-table-wrap">
        <table className="comparison-table" style={{ minWidth: `${14 + selected.length * 13}rem` }}>
          <thead>
            <tr>
              <th scope="col" className="comparison-metric-heading">Decision factor</th>
              {selected.map((county, index) => (
                <th scope="col" key={county.county_fips}>
                  <label htmlFor={`comparison-county-${index}`}>County {index + 1}</label>
                  <select id={`comparison-county-${index}`} value={county.county_fips} onChange={(event) => replaceCounty(index, event.target.value)}>
                    {counties.map((option) => <option key={option.county_fips} value={option.county_fips}>{option.county_name}</option>)}
                  </select>
                  <div className="comparison-column-actions">
                    <button className="comparison-locate" type="button" onClick={() => onSelectCounty(county.county_fips)}>Show on map</button>
                    {selected.length > 2 && (
                      <button className="comparison-remove" type="button" onClick={() => removeCounty(county.county_fips)} aria-label={`Remove ${county.county_name} from comparison`}>
                        Remove
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <span className="comparison-row-label">{row.label}</span>
                  <span className="comparison-row-hint">{row.hint}</span>
                  <SourceLinks sources={row.sources} />
                </th>
                {selected.map((county) => <td key={county.county_fips}>{row.render(county)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="comparison-footnote">
        Funding priority is a derived recommendation. {formatBucket('fund_charger_now')} means demand and grid gates support deployment; {formatBucket('fund_grid_upgrade_first').toLowerCase()} means grid work should lead.
      </p>
    </div>
  );
}
