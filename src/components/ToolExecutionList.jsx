// The agent has to supply a `reason` for every metered tool call, and the
// live tools return real named infrastructure. Rendering only the function
// name threw both away, which made deliberate, costed decisions look like an
// opaque list of calls. This surfaces what it did, why, and what it paid.

const LABEL = {
  get_statewide_summary: 'Read statewide summary',
  get_county_demand_metrics: 'Read county demand metrics',
  get_grid_infrastructure: 'Read cached grid fields',
  evaluate_feasibility_gates: 'Evaluated feasibility gates',
  ask_mireye_evidence: 'Asked Mireye for cited evidence',
  fetch_live_grid_fields: 'Fetched live grid fields',
  sample_county_points: 'Sampled extra county points',
  find_nearest_substations: 'Looked up nearest substations',
  get_labor_shed: 'Checked reachable population',
  make_funding_decision: 'Made funding decision',
};

function SubstationDetail({ result }) {
  const candidates = result.candidates ?? [];
  if (!candidates.length) return null;
  const strongest = result.highest_voltage_nearby;
  return (
    <table className="tool-detail-table">
      <tbody>
        {candidates.map((c, i) => (
          <tr key={i} className={strongest && c.name === strongest.name ? 'is-strongest' : ''}>
            <td>{c.name}</td>
            <td>{c.distance_miles != null ? `${c.distance_miles} mi` : '-'}</td>
            <td>{c.max_voltage_kv != null ? `${c.max_voltage_kv} kV` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LaborShedDetail({ result }) {
  if (result.quote_only) {
    return (
      <div className="tool-detail-note">
        Quoted {result.would_cost_credits?.toLocaleString()} credits for a {result.minutes} minute shed. Not run.
      </div>
    );
  }
  if (result.population_within_shed == null) return null;
  return (
    <div className="tool-detail-note">
      <strong>{result.population_within_shed.toLocaleString()}</strong> people and{' '}
      <strong>{result.civilian_labor_force_within_shed?.toLocaleString()}</strong> in the labour force within{' '}
      {result.minutes} minutes
      {result.population_within_shed === 0 ? ' (nobody can reach this point)' : ''}.
    </div>
  );
}

function SampledPointsDetail({ result }) {
  if (result.points_sampled == null) return null;
  return (
    <div className="tool-detail-note">
      {result.points_passing_gates} of {result.points_sampled} fresh points passed the gates
      {result.representativeness ? ` — cached sample looks ${result.representativeness}` : ''}.
    </div>
  );
}

function Detail({ tool, result }) {
  if (!result || result.error) {
    return result?.error ? <div className="tool-detail-note error">{result.error}</div> : null;
  }
  if (tool === 'find_nearest_substations') return <SubstationDetail result={result} />;
  if (tool === 'get_labor_shed') return <LaborShedDetail result={result} />;
  if (tool === 'sample_county_points') return <SampledPointsDetail result={result} />;
  return null;
}

export default function ToolExecutionList({ executions = [], creditsSpent }) {
  if (!executions.length) return null;

  return (
    <details className="tool-exec-block">
      <summary>
        ⚙️ Ran {executions.length} {executions.length === 1 ? 'tool' : 'tools'}
        {creditsSpent > 0 ? ` · ${creditsSpent} credits` : ' · no credits spent'}
      </summary>
      <div className="tool-exec-body">
        {executions.map((te, idx) => {
          const cost = te.result?.credits_spent ?? 0;
          const reason = te.result?.reason ?? te.args?.reason ?? null;
          return (
            <div key={idx} className="tool-exec">
              <div className="tool-exec-head">
                <span className="tool-exec-name">{LABEL[te.tool] ?? te.tool}</span>
                <span className={`tool-exec-cost ${cost > 0 ? 'paid' : 'free'}`}>
                  {cost > 0 ? `${cost} cr` : 'free'}
                </span>
              </div>
              {reason && <div className="tool-exec-reason">{reason}</div>}
              <Detail tool={te.tool} result={te.result} />
            </div>
          );
        })}
      </div>
    </details>
  );
}
