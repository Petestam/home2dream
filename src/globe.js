import Globe from 'globe.gl';

const ROCKET_BLUE = '#81acff';
const ROCKET_RED = '#de3341';
// Base transparency when no selection – highlights overlaps
const BASE_BLUE = 'rgba(129,172,255,0.6)';
const BASE_RED = 'rgba(222,51,65,0.6)';
// Dimmed when other arcs are in focus
const DIMMED_BLUE = 'rgba(129,172,255,0.08)';
const DIMMED_RED = 'rgba(222,51,65,0.08)';

// Refined chase gradient – soft blue → warm coral, graphic-design palette
const CHASE_BLUE = '#8eb9f2';
const CHASE_RED = '#e06969';

const ARC_COLORS = {
  selected: [CHASE_BLUE, CHASE_RED],
  base: [BASE_BLUE, BASE_RED],
  dimmed: [DIMMED_BLUE, DIMMED_RED],
};

// Chase: path highlighted (long dash), slight moving element (short gap), one-way hometown→dream home
const CHASE_DASH_LENGTH = 0.92;
const CHASE_DASH_GAP = 0.08;
const CHASE_CYCLE_MS = 18000;

/** easeInOutCubic – slow at ends, smooth through middle */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export { CHASE_CYCLE_MS };

export function createGlobe(container) {
  const globe = new Globe(container, { animateIn: false })
    .globeImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
    .arcsData([])
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcAltitude((d) => (d.arcState === 'selected' ? 0.18 : 0.1))
    .arcColor((d) => ARC_COLORS[d.arcState] || ARC_COLORS.base)
    .arcDashLength((d) => (d.arcState === 'selected' ? CHASE_DASH_LENGTH : 1))
    .arcDashGap((d) => (d.arcState === 'selected' ? CHASE_DASH_GAP : 0))
    .arcDashInitialGap((d) => (d.arcState === 'selected' ? (d.__dashPhase ?? 0) : 0))
    .arcDashAnimateTime((d) => (d.arcState === 'selected' ? 0 : 0))
    .arcStroke((d) => {
      if (d.arcState === 'selected') return 0.15;
      if (d.arcState === 'dimmed') return 0.08;
      return 0.2;
    })
    .arcsTransitionDuration(1800)
    .pointsData([])
    .pointLat((d) => d.lat)
    .pointLng((d) => d.lng)
    .pointColor((d) => (d.type === 'hometown' ? ROCKET_BLUE : ROCKET_RED))
    .pointRadius((d) => (d.type === 'hometown' ? 0.4 : 0.55))
    .pointAltitude((d) => (d.type === 'hometown' ? 0.1 : 0.15))
    .pointLabel((d) => d.label)
    .pointsTransitionDuration(1800);

  const introStart = { lat: 42, lng: -75, altitude: DEFAULT_ALTITUDE * 1.12 };
  globe.pointOfView(introStart, 0);
  globe.onGlobeReady(() => {
    requestAnimationFrame(() => {
      container.classList.remove('preload');
      setTimeout(() => playIntroAnimation(globe), 100);
    });
  });
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

const FOCUS_TRANSITION_MS = 2400;

// Default: full globe in viewport with 1/16 padding, centered on USA
const DEFAULT_PADDING = 1 / 16;
const DEFAULT_ALTITUDE = 2.5 / (1 - 2 * DEFAULT_PADDING);
const USA_CENTER = { lat: 39.5, lng: -98.5 };
const INTRO_MS = 4200;

function playIntroAnimation(globe) {
  globe.pointOfView(
    { lat: USA_CENTER.lat, lng: USA_CENTER.lng, altitude: DEFAULT_ALTITUDE },
    INTRO_MS
  );
}

// Arc focus: zoom to arc extents with 1/8 padding – closer zoom to highlight arc
const FOCUS_PADDING = 1 / 8;
const FOCUS_PADDING_FACTOR = 1 / (1 - 2 * FOCUS_PADDING);
const FOCUS_ZOOM = 0.72; // zoom in further to emphasize arc

export function fitArcInView(globe, arc) {
  if (!arc) return;
  const { startLat, startLng, endLat, endLng } = arc;
  const lat = (startLat + endLat) / 2;
  const lng = (startLng + endLng) / 2;
  const span = Math.max(
    Math.abs(endLat - startLat),
    Math.abs(endLng - startLng),
    5
  );
  const tightAltitude = Math.max(0.95, 1.1 + span * 0.006);
  const altitude = (tightAltitude * FOCUS_PADDING_FACTOR) * FOCUS_ZOOM;
  globe.pointOfView({ lat, lng, altitude }, FOCUS_TRANSITION_MS);
}

export function fitArcsInView(globe, journeys) {
  if (!journeys || journeys.length === 0) return;
  globe.pointOfView(
    { lat: USA_CENTER.lat, lng: USA_CENTER.lng, altitude: DEFAULT_ALTITUDE },
    FOCUS_TRANSITION_MS
  );
}
