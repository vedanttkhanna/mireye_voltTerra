export default function CitationChip({ citation }) {
  if (!citation || !citation.source) return null;

  const getFaviconLabel = (source) => {
    const s = source.toLowerCase();
    if (s.includes('eia')) return '⚡ EIA';
    if (s.includes('osm') || s.includes('openstreetmap')) return '🗺️ OSM';
    if (s.includes('dmv') || s.includes('fuel')) return '🚗 DMV';
    if (s.includes('afdc') || s.includes('doe') || s.includes('charger')) return '🔌 DOE';
    if (s.includes('caiso') || s.includes('iso')) return '⚙️ CAISO';
    return '🔗 Source';
  };

  return (
    <a
      href={citation.source_url || '#'}
      target={citation.source_url ? '_blank' : '_self'}
      rel="noreferrer"
      className="citation-chip-pill"
      title={`${citation.source}${citation.confidence ? ` (Confidence: ${citation.confidence})` : ''} - Click to inspect source`}
      onClick={(e) => {
        if (!citation.source_url) e.preventDefault();
      }}
    >
      <span className="chip-icon">{getFaviconLabel(citation.source)}</span>
      <span className="chip-name">{citation.source}</span>
      <span className="chip-arrow">↗</span>
    </a>
  );
}
