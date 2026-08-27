import { useEffect, useState } from 'react';

/**
 * Typed alternative to clicking the map. Accepts county names, address/city/zip
 * geocoding search, or exact numeric coordinates.
 */
export default function ManualEntry({ mode, counties = [], onSelectCounty, onPickPoint, busy }) {
  const [countyQuery, setCountyQuery] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const countyMatches = countyQuery.trim().length >= 2
    ? counties
        .filter((c) => c.county_name.toLowerCase().includes(countyQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  useEffect(() => {
    const q = addressQuery.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }

    const coordParts = q.split(',').map((s) => s.trim());
    if (coordParts.length === 2 && !isNaN(Number(coordParts[0])) && !isNaN(Number(coordParts[1]))) {
      setSuggestions([
        {
          display_name: `Coordinates: ${coordParts[0]}, ${coordParts[1]}`,
          lat: Number(coordParts[0]),
          lon: Number(coordParts[1]),
        },
      ]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=5`
        );
        const data = await res.json();
        setSuggestions(
          data.map((item) => ({
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
          }))
        );
      } catch {
        // network or search failure fallback
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [addressQuery]);

  const selectSuggestion = (item) => {
    setAddressQuery(item.display_name.split(',')[0]);
    setLat(String(item.lat));
    setLng(String(item.lon));
    setSuggestions([]);
    setError(null);
    onPickPoint?.({ lat: item.lat, lng: item.lon });
  };

  const submitCoords = (e) => {
    e.preventDefault();
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || la < -90 || la > 90) return setError('Latitude must be between -90 and 90');
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) return setError('Longitude must be between -180 and 180');
    setError(null);
    onPickPoint?.({ lat: la, lng: ln });
  };

  return (
    <div className="manual-entry">
      {mode === 'facility' && (
        <div className="manual-section" style={{ marginBottom: '1rem' }}>
          <label className="manual-label" htmlFor="county-input">Find a county by name</label>
          <input
            id="county-input"
            className="manual-input"
            value={countyQuery}
            onChange={(e) => setCountyQuery(e.target.value)}
            placeholder="Start typing county, e.g. Maricopa, Clark, King"
            autoComplete="off"
          />
          {countyMatches.length > 0 && (
            <div className="manual-matches">
              {countyMatches.map((c) => (
                <button
                  key={c.county_fips}
                  onClick={() => {
                    onSelectCounty?.(c.county_fips);
                    setCountyQuery(c.county_name);
                    const cLat = c.lat ?? c.grid_feasibility?.sampled_at?.lat;
                    const cLng = c.lng ?? c.grid_feasibility?.sampled_at?.lng;
                    if (Number.isFinite(cLat) && Number.isFinite(cLng)) {
                      onPickPoint?.({ lat: cLat, lng: cLng });
                    }
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.county_name}</span>
                  <span className="manual-match-meta">
                    {c.driver_to_plug_ratio != null
                      ? `${c.driver_to_plug_ratio.toLocaleString()} ${
                          c.people_per_port != null ? 'people/port' : 'EVs/port'
                        }`
                      : 'no ports'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {countyQuery.trim().length >= 2 && countyMatches.length === 0 && (
            <p className="manual-hint">No county matches “{countyQuery.trim()}”.</p>
          )}
        </div>
      )}

      <div className="manual-section" style={{ marginBottom: '0.85rem' }}>
        <label className="manual-label" htmlFor="address-search-input">
          Search address, city, or ZIP code
        </label>
        <input
          id="address-search-input"
          className="manual-input"
          value={addressQuery}
          onChange={(e) => setAddressQuery(e.target.value)}
          placeholder="e.g. Seattle, WA, 90210, or Las Vegas, NV"
          autoComplete="off"
        />
        {searching && <p className="manual-hint">Searching location…</p>}
        {suggestions.length > 0 && (
          <div className="manual-matches">
            {suggestions.map((item, idx) => (
              <button key={idx} onClick={() => selectSuggestion(item)}>
                <span style={{ fontSize: '0.82rem' }}>📍 {item.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={submitCoords}>
        <label className="manual-label" htmlFor="lat-input">
          Or enter exact coordinates
        </label>
        <div className="manual-coords">
          <input
            id="lat-input"
            className="manual-input"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="Latitude (e.g. 36.1699)"
            inputMode="decimal"
          />
          <input
            className="manual-input"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="Longitude (e.g. -115.1398)"
            inputMode="decimal"
          />
          <button type="submit" className="manual-go" disabled={busy}>
            {busy ? '…' : 'Go'}
          </button>
        </div>
      </form>
      {error && <p className="manual-hint error">{error}</p>}
    </div>
  );
}
