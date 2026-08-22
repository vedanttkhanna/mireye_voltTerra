const GATE_LABELS = {
  no_substation_found: 'No substation found within radius (EIA or OSM)',
  distance_too_far: 'Nearest substation is too far away (> 8km)',
  voltage_too_low: 'Nearest substation voltage is below the sub-transmission floor (< 60kV)',
};

export function gateFailureLabel(key) {
  if (key.startsWith('substation_not_in_service')) {
    return `Substation status: ${key.split(':')[1] ?? 'not in service'}`;
  }
  return GATE_LABELS[key] ?? key;
}

export default function GateFailureList({ failures }) {
  if (!failures || failures.length === 0) {
    return (
      <div style={{ marginTop: '0.75rem', background: 'var(--accent-light, #ecfdf5)', border: '1px solid var(--accent-border, #a7f3d0)', borderRadius: 6, padding: '0.4rem 0.65rem' }}>
        <p style={{ margin: 0, color: 'var(--accent-darker, #065f46)', fontSize: '0.85rem', fontWeight: 600 }}>
          ✓ All grid-feasibility gates passed.
        </p>
      </div>
    );
  }
  return (
    <div style={{ marginTop: '0.75rem', background: 'var(--warn-light, #fffbeb)', border: '1px solid var(--warn-border, #fde68a)', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
      <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--warn-dark, #b45309)', fontSize: '0.85rem' }}>
        {failures.map((f) => (
          <li key={f}>{gateFailureLabel(f)}</li>
        ))}
      </ul>
    </div>
  );
}
