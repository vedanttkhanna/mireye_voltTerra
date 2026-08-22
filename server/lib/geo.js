const EARTH_RADIUS_M = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two {lat, lng} points, in meters. */
export function haversineDistanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Arithmetic mean of a list of {lat, lng} points. Returns null for an empty list. */
export function meanPoint(points) {
  if (!points || points.length === 0) return null;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

// --- Point-in-polygon (for resolving which county a map click landed in) --
//
// GeoJSON ring coordinates are [lng, lat] pairs, opposite of this file's
// {lat, lng} point convention elsewhere — kept that way here because it's
// what the Census boundary GeoJSON (county-boundaries.js) and Leaflet both
// use natively; converting at the geometry boundary would just move the
// bug risk instead of removing it.

/** Standard ray-casting test: is {lat,lng} inside one [lng,lat][] ring? */
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * A GeoJSON Polygon's `coordinates` is a list of rings: the first is the
 * exterior, any further rings are holes. XORing containment across every
 * ring is the standard way to make holes fall out "for free" — a point
 * inside both the exterior ring and a hole ring cancels back to outside,
 * with no separate hole-handling logic needed.
 */
function pointInPolygonCoords(point, polygonCoords) {
  let inside = false;
  for (const ring of polygonCoords) {
    if (pointInRing(point, ring)) inside = !inside;
  }
  return inside;
}

/** Handles the three geometry types Census county boundaries use: Polygon, MultiPolygon, GeometryCollection. */
export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  switch (geometry.type) {
    case 'Polygon':
      return pointInPolygonCoords(point, geometry.coordinates);
    case 'MultiPolygon':
      return geometry.coordinates.some((polygonCoords) => pointInPolygonCoords(point, polygonCoords));
    case 'GeometryCollection':
      return geometry.geometries.some((g) => pointInGeometry(point, g));
    default:
      return false;
  }
}

/** Returns the first GeoJSON feature whose geometry contains the point, or null. */
export function findContainingFeature(point, featureCollection) {
  return featureCollection.features.find((f) => pointInGeometry(point, f.geometry)) ?? null;
}
