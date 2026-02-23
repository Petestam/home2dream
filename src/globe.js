// Globe.GL loaded via CDN - use global
const Globe = window.Globe;

const ROCKET_BLUE = '#81acff';
const ROCKET_RED = '#de3341';
// Base transparency when no selection – highlights overlaps
const BASE_BLUE = 'rgba(129,172,255,0.6)';
const BASE_RED = 'rgba(222,51,65,0.6)';
// Dimmed when other arcs are in focus
const DIMMED_BLUE = 'rgba(129,172,255,0.08)';
const DIMMED_RED = 'rgba(222,51,65,0.08)';

const ARC_COLORS = {
  selected: [ROCKET_BLUE, ROCKET_RED],
  base: [BASE_BLUE, BASE_RED],
  dimmed: [DIMMED_BLUE, DIMMED_RED],
};

export function createGlobe(container) {
  if (!Globe) throw new Error('Globe.GL not loaded - ensure script tag is present');
  const globe = new Globe(container)
    .globeImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
    .arcsData([])
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcAltitude(0.3)
    .arcColor((d) => ARC_COLORS[d.arcState] || ARC_COLORS.base)
    .arcDashLength(0.5)
    .arcDashAnimateTime(2000)
    .arcStroke(0.5)
    .pointsData([])
    .pointLat((d) => d.lat)
    .pointLng((d) => d.lng)
    .pointColor((d) => (d.type === 'hometown' ? ROCKET_BLUE : ROCKET_RED))
    .pointRadius((d) => (d.type === 'hometown' ? 0.4 : 0.55))
    .pointAltitude((d) => (d.type === 'hometown' ? 0.1 : 0.15))
    .pointLabel((d) => d.label);

  return globe;
}

/** arcState: 'selected' | 'base' | 'dimmed' */
export function journeyToArc(j, arcState = 'base') {
  return {
    startLat: j.startLat,
    startLng: j.startLng,
    endLat: j.endLat,
    endLng: j.endLng,
    arcState,
  };
}

export function journeyToPoints(j) {
  if (!j) return [];
  return [
    { lat: j.startLat, lng: j.startLng, label: `Hometown: ${j.city}`, type: 'hometown' },
    { lat: j.endLat, lng: j.endLng, label: `Dream Home: ${j.dreamHomeName}`, type: 'dream' },
  ];
}

export function journeysToPoints(journeys) {
  if (!journeys || journeys.length === 0) return [];
  return journeys.flatMap(journeyToPoints);
}

export function fitArcInView(globe, arc) {
  if (!arc) return;
  const { startLat, startLng, endLat, endLng } = arc;
  const lat = (startLat + endLat) / 2;
  const lng = (startLng + endLng) / 2;
  const altitude = 2.5;
  globe.pointOfView({ lat, lng, altitude }, 800);
}

export function fitArcsInView(globe, journeys) {
  if (!journeys || journeys.length === 0) return;
  const lats = journeys.flatMap((j) => [j.startLat, j.endLat]);
  const lngs = journeys.flatMap((j) => [j.startLng, j.endLng]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lngs) - Math.min(...lngs)
  );
  const altitude = Math.max(2, 3 - span * 0.5);
  globe.pointOfView({ lat, lng, altitude }, 800);
}
