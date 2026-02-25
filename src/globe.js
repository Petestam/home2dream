import Globe from 'globe.gl';
import * as THREE from 'three';

// Preferred Map / Pins styling: Rocket Red, burgundy pin, white accents
const ROCKET_RED = '#de3341';
const PINK_BASE = '#fee8f4';
const PINK_MID = '#f09cb3';
const PINK_DARK = '#661a2e';
const PREFERRED_PIN = '#de3341';
const PIN_BURGUNDY = '#a02030';   // Dream home pin body (darker red)
const MARKER_WHITE = '#ffffff';
const EARTH_RADIUS_MI = 3959;
const MARKER_WIDTH_MI = 10000;
const MARKER_SCALE = MARKER_WIDTH_MI / EARTH_RADIUS_MI;  // ~0.0126, so dot/pin diameter = 50 mi on globe

// Globe surface: vector land (white) on light grey ocean, #E9E9E9 borders
const GLOBE_BG = '#ffffff';
const LAND_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_land.geojson';
const STATE_LINES_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces_lines.geojson';
const COUNTRY_LINES_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';
const OCEAN_COLOR = '#e9e9e9';
const LAND_COLOR = '#ffffff';
const BORDER_COLOR = '#E9E9E9';
const STATE_LINE_COLOR = '#666666';
const LAND_ALTITUDE = 0.01;

// Shading/performance: cap pixel ratio and prefer GPU; lower = faster, higher-DPI screens
const MAX_PIXEL_RATIO = 2;

const ARC_COLORS = {
  selected: [ROCKET_RED, ROCKET_RED],           // 10px solid #DE3341
  base: ['rgba(222,51,65,0.5)', 'rgba(222,51,65,0.5)'],
  dimmed: ['rgba(222,51,65,0.08)', 'rgba(222,51,65,0.08)'],
};

/** Apply depth bias only to land polygon meshes (not markers) so boundaries draw on top without hiding dot/pin */
function applyLandDepthBias(scene, globeMaterial) {
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material !== globeMaterial) {
      if (obj.material.userData?.isMarker) return;
      obj.material.polygonOffset = true;
      obj.material.polygonOffsetFactor = 2;
      obj.material.polygonOffsetUnits = 2;
      obj.renderOrder = 0;
    }
  });
}

/** Set boundary path lines to render after land so they appear on top without fighting */
function applyPathsRenderOrder(scene) {
  scene.traverse((obj) => {
    if ((obj.isLine || obj.isLineSegments) && obj.material) {
      obj.renderOrder = 1;
    }
  });
}

/** Depth bias so marker meshes render in front of land (reduces z-fighting). */
function applyMarkerDepthBias(mat) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
}

/** Convert GeoJSON boundary features (LineString / MultiLineString) to path objects for pathsData */
function boundaryGeoJsonToPaths(geojson) {
  const paths = [];
  if (!geojson?.features?.length) return paths;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom?.coordinates) continue;
    if (geom.type === 'LineString') {
      paths.push({ points: geom.coordinates.map(([lng, lat]) => [lat, lng]) });
    } else if (geom.type === 'MultiLineString') {
      for (const ring of geom.coordinates) {
        paths.push({ points: ring.map(([lng, lat]) => [lat, lng]) });
      }
    }
  }
  return paths;
}

/** Generate a light grey ocean texture at runtime (avoids black globe) */
function getOceanTextureUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = OCEAN_COLOR;
  ctx.fillRect(0, 0, 2, 2);
  return canvas.toDataURL('image/png');
}

/** Ease in-out cubic: slow at ends, smooth through middle. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Origin dot: red circle with white center; anchor at center. */
function makeOriginDot() {
  const group = new THREE.Group();
  const outerMat = new THREE.MeshBasicMaterial({ color: ROCKET_RED });
  outerMat.userData.isMarker = true;
  applyMarkerDepthBias(outerMat);
  const innerMat = new THREE.MeshBasicMaterial({ color: MARKER_WHITE });
  innerMat.userData.isMarker = true;
  applyMarkerDepthBias(innerMat);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), outerMat);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), innerMat);
  inner.position.z = 0.001;
  group.add(outer);
  group.add(inner);
  group.scale.setScalar(MARKER_SCALE);
  return group;
}

/**
 * Dream pin: tip (point) at anchor (arc end), large side (base) out along radial.
 * Cone axis = +Z; objectFacesSurface aligns +Z with surface normal.
 */
function makeDreamPin() {
  const group = new THREE.Group();
  const coneRad = 0.5;
  const coneH = 1;
  // ConeGeometry (Three.js): centered, tip at +Y, base at -Y. Translate so tip at origin, base at -Y.
  const cone = new THREE.ConeGeometry(coneRad, coneH, 32);
  cone.translate(0, -coneH / 2, 0);
  const outlineGeom = new THREE.ConeGeometry(coneRad * 1.08, coneH * 1.04, 32);
  outlineGeom.translate(0, -coneH / 2, 0);
  const outlineMat = new THREE.MeshBasicMaterial({ color: ROCKET_RED });
  outlineMat.userData.isMarker = true;
  applyMarkerDepthBias(outlineMat);
  const bodyMat = new THREE.MeshBasicMaterial({ color: ROCKET_RED });
  bodyMat.userData.isMarker = true;
  applyMarkerDepthBias(bodyMat);
  const tipMat = new THREE.MeshBasicMaterial({ color: ROCKET_RED });
  tipMat.userData.isMarker = true;
  applyMarkerDepthBias(tipMat);
  const outline = new THREE.Mesh(outlineGeom, outlineMat);
  const body = new THREE.Mesh(cone, bodyMat);
  const tipDot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), tipMat);
  tipDot.position.y = 0.01;
  tipDot.rotation.x = -Math.PI / 2;
  group.add(outline);
  group.add(body);
  group.add(tipDot);
  // Tip at origin, base at -Y. Rotate so axis is Z: base out. rotation.z = PI flips so base is at +Z (out).
  group.rotation.x = Math.PI / 2;
  group.rotation.z = Math.PI;
  group.scale.setScalar(MARKER_SCALE);
  return group;
}

const originDotTemplate = makeOriginDot();
const dreamPinTemplate = makeDreamPin();

/** Set arc layer renderOrder above markers so arcs draw on top of dot/pin. */
export function setArcsAboveMarkers(globe) {
  globe.scene().traverse((obj) => {
    if (obj.isMesh && obj.geometry?.type === 'TubeGeometry') obj.renderOrder = 2;
  });
}

export function createGlobe(container) {
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const globe = new Globe(container, {
    animateIn: false,
    rendererConfig: {
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      pixelRatio,
    },
  })
    .globeImageUrl(getOceanTextureUrl())
    .backgroundColor(GLOBE_BG)
    .globeCurvatureResolution(10)
    .showGraticules(true)
    .polygonsData([])
    .polygonGeoJsonGeometry((d) => d.geometry)
    .polygonCapColor(() => LAND_COLOR)
    .polygonSideColor(() => '#e8e8e8')
    .polygonStrokeColor(() => BORDER_COLOR)
    .polygonAltitude(LAND_ALTITUDE)
    .polygonCapCurvatureResolution(5)
    .pathsData([])
    .pathPoints((d) => d.points)
    .pathPointLat((p) => p[0])
    .pathPointLng((p) => p[1])
    .pathPointAlt(() => LAND_ALTITUDE)
    .pathColor(() => STATE_LINE_COLOR)
    .pathStroke(0.28)
    .pathResolution(1.5)
    .arcsData([])
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcStartAltitude(LAND_ALTITUDE)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcEndAltitude(LAND_ALTITUDE)
    .arcAltitude((d) => (d.arcState === 'selected' ? 0.18 : 0.1))
    .arcColor((d) =>
      d.__revealed === false ? 'rgba(0,0,0,0)' : (ARC_COLORS[d.arcState] || ARC_COLORS.base)
    )
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0)
    .arcStroke((d) => {
      if (d.arcState === 'selected') return 0.18;
      if (d.arcState === 'dimmed') return 0.06;
      return 0.12;
    })
    .arcCurveResolution(64)
    .arcCircularResolution(6)
    .arcsTransitionDuration(1800)
    .objectsData([])
    .objectLat((d) => d.lat)
    .objectLng((d) => d.lng)
    .objectAltitude(() => LAND_ALTITUDE + 0.005)
    .objectLabel((d) => d.label)
    .objectThreeObject((d) => {
      const clone = d.type === 'hometown' ? originDotTemplate.clone(true) : dreamPinTemplate.clone(true);
      clone.renderOrder = 1;
      return clone;
    })
    .objectFacesSurface(true); // pin stands along surface normal (vertical from globe)

  const introStart = { lat: 42, lng: -75, altitude: DEFAULT_ALTITUDE * 1.12 };
  globe.pointOfView(introStart, 0);
  globe.onGlobeReady(() => {
    const mat = globe.globeMaterial();
    const map = mat.map;
    const oceanMat = new THREE.MeshPhongMaterial({
      map,
      color: new THREE.Color(OCEAN_COLOR),
      emissive: new THREE.Color(0.06, 0.07, 0.09),
      shininess: 12,
      specular: new THREE.Color(0.15, 0.18, 0.22),
      side: THREE.FrontSide,
    });
    globe.globeMaterial(oceanMat);
    const scene = globe.scene();
    scene.traverse((obj) => {
      if (obj.isLineSegments && obj.material?.opacity < 0.5) {
        obj.material.color.set(BORDER_COLOR);
        obj.material.opacity = 0.6;
      }
    });
    fetch(LAND_GEOJSON_URL)
      .then((r) => r.json())
      .then((geojson) => {
        if (geojson.features && geojson.features.length) {
          globe.polygonsData(geojson.features);
          requestAnimationFrame(() => applyLandDepthBias(globe.scene(), oceanMat));
        }
      })
      .catch(() => {});
    Promise.all([
      fetch(STATE_LINES_GEOJSON_URL).then((r) => r.json()).catch(() => ({ features: [] })),
      fetch(COUNTRY_LINES_GEOJSON_URL).then((r) => r.json()).catch(() => ({ features: [] })),
    ]).then(([stateGeo, countryGeo]) => {
      const paths = [
        ...boundaryGeoJsonToPaths(stateGeo),
        ...boundaryGeoJsonToPaths(countryGeo),
      ];
      if (paths.length) {
        globe.pathsData(paths);
        requestAnimationFrame(() => applyPathsRenderOrder(globe.scene()));
      }
    });
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
