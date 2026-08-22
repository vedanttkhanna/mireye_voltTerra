const GATE_LABELS = {
  no_substation_found: 'No substation found within radius (EIA or OSM)',
  distance_too_far: 'Nearest substation is too far away',
  voltage_too_low: 'Nearest substation voltage is below the sub-transmission floor (60kV)',
};

export function gateFailureLabel(key) {
  if (key.startsWith('substation_not_in_service')) {
    return `Substation status: ${key.split(':')[1] ?? 'not in service'}`;
  }
  return GATE_LABELS[key] ?? key;
}

export default function GateFailureList({ failures }) {
  if (!failures || failures.length === 0) {
    return <p style={{ marginTop: '0.75rem', color: '#00e676', fontSize: '0.85rem' }}>All grid-feasibility gates passed.</p>;
  }
  return (
    <ul style={{ marginTop: '0.75rem', color: '#ffab00', fontSize: '0.85rem' }}>
      {failures.map((f) => (
        <li key={f}>{gateFailureLabel(f)}</li>
      ))}
    </ul>
  );
}
