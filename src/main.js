import { loadJourneys } from './csvLoader.js';
import {
  createGlobe,
  journeyToArc,
  journeyToPoints,
  journeysToPoints,
  fitArcInView,
  fitArcsInView,
  easeInOutCubic,
} from './globe.js';

const IDLE_MS = 30000;
const JOURNEY_CYCLE_MS = 8000;
const BUILD_DURATION_MS = 20000;
const BUILD_BATCH_COUNT = 50;

const SORT_OPTIONS = {
  'date-desc': (a, b) => new Date(b.scoreCreatedOn) - new Date(a.scoreCreatedOn),
  'date-asc': (a, b) => new Date(a.scoreCreatedOn) - new Date(b.scoreCreatedOn),
  'distance-asc': (a, b) => a.distance - b.distance,
  'distance-desc': (a, b) => b.distance - a.distance,
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function matchesSearch(journey, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    (journey.firstName && journey.firstName.toLowerCase().includes(lower)) ||
    (journey.lastName && journey.lastName.toLowerCase().includes(lower)) ||
    (journey.email && journey.email.toLowerCase().includes(lower))
  );
}

function formatDistance(mi) {
  const km = mi * 1.60934;
  return `${Math.round(mi).toLocaleString()} mi (${Math.round(km).toLocaleString()} km)`;
}

function renderJourneyCard(journey, isSelected, index) {
  const initial = journey.lastName ? journey.lastName.charAt(0) + '.' : '';
  const name = `${journey.firstName} ${initial}`.trim() || '—';
  const route = `${journey.city} → ${journey.dreamHomeName}`;
  const dist = formatDistance(journey.distance);
  const cls = isSelected ? 'journey-card selected' : 'journey-card';
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = `
    <div class="journey-card-name">${escapeHtml(name)}</div>
    <div class="journey-card-route">${escapeHtml(route)}</div>
    <div class="journey-card-distance">${escapeHtml(dist)}</div>
  `;
  return div;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  const searchEl = document.getElementById('search');
  const sortEl = document.getElementById('sort');
  const showAllEl = document.getElementById('showAll');
  const dayFiltersEl = document.getElementById('dayFilters');
  const journeyListEl = document.getElementById('journeyList');
  const resultCountEl = document.getElementById('resultCount');
  const emptyStateEl = document.getElementById('emptyState');
  const emptySearchTermEl = document.getElementById('emptySearchTerm');
  const clearSearchEl = document.getElementById('clearSearch');
  const infoSummaryEl = document.getElementById('infoSummary');
  const infoDetailEl = document.getElementById('infoDetail');
  const infoDistanceEl = document.getElementById('infoDistance');
  const infoRouteEl = document.getElementById('infoRoute');
  const playBtn = document.getElementById('playBtn');

  let allJourneys = [];
  let filteredJourneys = [];
  let selectedIndices = new Set();
  let lastClickedIndex = null;
  let showAll = true;

  const globeContainer = document.getElementById('globeViz');
  const journeys = await loadJourneys();
  allJourneys = journeys;

  const globe = createGlobe(globeContainer);

  let isExploring = false;
  let explorationIdleTimer = null;
  let explorationCycleTimer = null;
  let lastArcsData = [];

  let isPlayback = false;
  let playbackRafId = null;
  let playbackStartTime = 0;
  let playbackList = [];
  let playbackLastBatch = -1;

  function onUserActivity() {
    if (isExploring) stopExploration();
    if (isPlayback) stopPlayback();
    if (explorationIdleTimer) clearTimeout(explorationIdleTimer);
    explorationIdleTimer = setTimeout(startExploration, IDLE_MS);
  }

  function startExploration() {
    if (filteredJourneys.length === 0) return;
    if (selectedIndices.size > 0) return;
    if (explorationIdleTimer) clearTimeout(explorationIdleTimer);
    explorationIdleTimer = null;
    if (explorationCycleTimer) {
      clearTimeout(explorationCycleTimer);
      explorationCycleTimer = null;
    }
    isExploring = true;
    const controls = globe.controls?.();
    if (controls) controls.autoRotate = false;
    cycleExplorationJourney();
  }

  function cycleExplorationJourney() {
    if (!isExploring || filteredJourneys.length === 0) return;
    const idx = Math.floor(Math.random() * filteredJourneys.length);
    selectedIndices = new Set([idx]);
    lastClickedIndex = idx;
    updateUI();
    explorationCycleTimer = setTimeout(cycleExplorationJourney, JOURNEY_CYCLE_MS);
  }

  function stopExploration() {
    isExploring = false;
    if (explorationCycleTimer) {
      clearTimeout(explorationCycleTimer);
      explorationCycleTimer = null;
    }
    selectedIndices.clear();
    lastClickedIndex = null;
    updateUI(true);
  }

  function startPlayback() {
    const list = getSortedFiltered();
    if (list.length === 0) return;
    if (isExploring) stopExploration();
    if (explorationIdleTimer) clearTimeout(explorationIdleTimer);
    explorationIdleTimer = null;
    filteredJourneys = list;
    isPlayback = true;
    playbackList = [...list].sort(
      (a, b) => new Date(a.scoreCreatedOn) - new Date(b.scoreCreatedOn)
    );
    const arcs = playbackList.map((j, i) => ({
      ...journeyToArc(j, 'base'),
      __revealed: false,
      __sortIndex: i,
    }));
    lastArcsData = arcs;
    globe.arcsData(arcs);
    globe.pointsData([]);
    journeyListEl.parentElement?.classList.add('playback-building');
    resultCountEl.textContent = `Building: 0 of ${arcs.length}`;
    playBtn.classList.add('playing');
    playBtn.querySelector('.play-label').textContent = 'Pause';
    playBtn.querySelector('.play-icon').textContent = '❚❚';
    playbackStartTime = performance.now();
    tickPlayback();
  }

  function tickPlayback() {
    if (!isPlayback || playbackList.length === 0) return;
    const elapsed = performance.now() - playbackStartTime;
    const rawT = Math.min(1, elapsed / BUILD_DURATION_MS);
    const easedT = easeInOutCubic(rawT);
    const total = lastArcsData.length;
    const targetReveal = Math.floor(easedT * total);
    const batchSize = Math.max(1, Math.ceil(total / BUILD_BATCH_COUNT));
    const currentBatch = Math.floor(targetReveal / batchSize);
    if (currentBatch > playbackLastBatch || rawT >= 1) {
      playbackLastBatch = currentBatch;
      const revealUpTo = rawT >= 1 ? total : Math.min(total, (currentBatch + 1) * batchSize);
      for (let i = 0; i < total; i++) lastArcsData[i].__revealed = i < revealUpTo;
      globe.arcsData(lastArcsData);
    }
    const count = Math.min(targetReveal, total);
    infoSummaryEl.textContent = `${count} of ${total} journeys · Building...`;
    resultCountEl.textContent = `Building: ${count} of ${total}`;
    if (rawT >= 1) {
      stopPlayback();
      return;
    }
    playbackRafId = requestAnimationFrame(tickPlayback);
  }

  function stopPlayback() {
    isPlayback = false;
    playbackLastBatch = -1;
    if (playbackRafId) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
    }
    playbackList = [];
    journeyListEl.parentElement?.classList.remove('playback-building');
    playBtn.classList.remove('playing');
    playBtn.querySelector('.play-label').textContent = 'Play';
    playBtn.querySelector('.play-icon').textContent = '▶';
    selectedIndices.clear();
    lastClickedIndex = null;
    filteredJourneys = getSortedFiltered();
    updateUI(true, { skipFit: true });
  }

  function getSelectedDays() {
    const active = dayFiltersEl?.querySelectorAll('.day-pill.active') || [];
    if (active.length === 0) return null;
    return new Set(Array.from(active).map((p) => parseInt(p.dataset.day, 10)));
  }

  function getSortedFiltered() {
    const q = searchEl.value.trim();
    const selectedDays = getSelectedDays();
    let list = allJourneys.filter((j) => {
      if (!matchesSearch(j, q)) return false;
      if (selectedDays != null && selectedDays.size > 0) {
        if (j.activationDay == null) return false;
        if (!selectedDays.has(j.activationDay)) return false;
      }
      return true;
    });
    const sortKey = sortEl.value;
    list = [...list].sort(SORT_OPTIONS[sortKey] || SORT_OPTIONS['date-desc']);
    return list;
  }

  function updateUI(fitToExtents = false, { skipFit = false, playbackMode = false } = {}) {
    if (!playbackMode) filteredJourneys = getSortedFiltered();
    const total = allJourneys.length;
    const count = filteredJourneys.length;

    resultCountEl.textContent = count === total ? `Showing ${count} journeys` : `Showing ${count} of ${total}`;

    if (count === 0) {
      lastArcsData = [];
      journeyListEl.classList.add('hidden');
      emptyStateEl.classList.remove('hidden');
      emptySearchTermEl.textContent = searchEl.value.trim();
      globe.arcsData([]);
      globe.pointsData([]);
      infoSummaryEl.classList.remove('hidden');
      infoDetailEl.classList.add('hidden');
      infoSummaryEl.textContent = 'No journeys match your search';
      const ctrl = globe.controls?.();
      if (ctrl) ctrl.autoRotate = false;
      return;
    }

    journeyListEl.classList.remove('hidden');
    emptyStateEl.classList.add('hidden');

    const hasSelection = selectedIndices.size > 0;
    let arcsData = showAll
      ? filteredJourneys.map((j, i) =>
          journeyToArc(j, hasSelection ? (selectedIndices.has(i) ? 'selected' : 'dimmed') : 'base')
        )
      : [...selectedIndices]
          .filter((i) => i < filteredJourneys.length)
          .map((i) => journeyToArc(filteredJourneys[i], 'selected'));

    if (hasSelection) {
      arcsData = [...arcsData].sort((a, b) => (a.arcState === 'selected' ? 1 : 0) - (b.arcState === 'selected' ? 1 : 0));
    }

    lastArcsData = arcsData;
    globe.arcsData(arcsData);

    const selectedJourneys = hasSelection
      ? [...selectedIndices].map((i) => filteredJourneys[i]).filter(Boolean)
      : [];
    globe.pointsData(journeysToPoints(selectedJourneys));

    if (hasSelection && selectedJourneys.length > 0) {
      infoSummaryEl.classList.add('hidden');
      infoDetailEl.classList.remove('hidden');
      if (selectedJourneys.length === 1) {
        const j = selectedJourneys[0];
        infoDistanceEl.textContent = formatDistance(j.distance);
        infoRouteEl.textContent = `${j.city} → ${j.dreamHomeName}`;
      } else {
        const totalMi = selectedJourneys.reduce((s, j) => s + j.distance, 0);
        infoDistanceEl.textContent = `${selectedJourneys.length} selected · ${formatDistance(totalMi / selectedJourneys.length)} avg`;
        const routes = selectedJourneys.map((j) => `${j.city} → ${j.dreamHomeName}`);
        infoRouteEl.textContent = routes.length <= 3 ? routes.join(' · ') : `${routes.length} routes`;
      }
      if (!playbackMode) {
        if (selectedJourneys.length === 1) {
          fitArcInView(globe, selectedJourneys[0]);
        } else {
          fitArcsInView(globe, selectedJourneys);
        }
      }
    } else {
      infoSummaryEl.classList.remove('hidden');
      infoDetailEl.classList.add('hidden');
      if (playbackMode && playbackList.length > 0) {
        const total = playbackList.length;
        const avgMi =
          count > 0 ? Math.round(filteredJourneys.reduce((s, j) => s + j.distance, 0) / count) : 0;
        infoSummaryEl.textContent = `${count} of ${total} journeys · Building...`;
      } else {
        const avgMi = Math.round(filteredJourneys.reduce((s, j) => s + j.distance, 0) / count);
        infoSummaryEl.textContent = `${count} journeys · Avg ${avgMi.toLocaleString()} mi · Click to focus, Shift/Ctrl for multi-select`;
      }
      if (fitToExtents && !skipFit) fitArcsInView(globe, filteredJourneys);
    }

    const controls = globe.controls?.();
    if (controls) controls.autoRotate = false;

    journeyListEl.innerHTML = '';
    filteredJourneys.forEach((j, i) => {
      const card = renderJourneyCard(j, selectedIndices.has(i), i);
      card.addEventListener('click', (e) => selectJourney(i, e));
      journeyListEl.appendChild(card);
    });
  }

  function selectJourney(index, event) {
    const ctrl = event?.ctrlKey || event?.metaKey;
    const shift = event?.shiftKey;

    if (ctrl) {
      if (selectedIndices.has(index)) {
        selectedIndices.delete(index);
      } else {
        selectedIndices.add(index);
      }
      lastClickedIndex = index;
    } else if (shift) {
      const start = lastClickedIndex ?? index;
      const lo = Math.min(start, index);
      const hi = Math.max(start, index);
      for (let i = lo; i <= hi; i++) selectedIndices.add(i);
      lastClickedIndex = index;
    } else {
      if (selectedIndices.has(index) && selectedIndices.size === 1) {
        selectedIndices.clear();
        lastClickedIndex = null;
      } else {
        selectedIndices = new Set([index]);
        lastClickedIndex = index;
      }
    }
    updateUI();
  }

  searchEl.addEventListener(
    'input',
    debounce(() => {
      selectedIndices.clear();
      lastClickedIndex = null;
      updateUI();
    }, 200)
  );

  sortEl.addEventListener('change', () => {
    selectedIndices.clear();
    lastClickedIndex = null;
    updateUI();
  });

  showAllEl.addEventListener('change', () => {
    showAll = showAllEl.checked;
    updateUI();
  });

  clearSearchEl.addEventListener('click', () => {
    searchEl.value = '';
    updateUI();
  });

  dayFiltersEl?.addEventListener('click', (e) => {
    const pill = e.target.closest('.day-pill');
    if (pill) {
      pill.classList.toggle('active');
      selectedIndices.clear();
      lastClickedIndex = null;
      updateUI();
    }
  });

  playBtn?.addEventListener('click', () => {
    if (isPlayback) {
      stopPlayback();
      onUserActivity();
    } else {
      startPlayback();
    }
  });

  const accordionTrigger = document.getElementById('accordionTrigger');
  const accordionContent = document.getElementById('accordionContent');
  accordionTrigger?.addEventListener('click', () => {
    onUserActivity();
    const open = accordionContent.classList.toggle('open');
    accordionTrigger.setAttribute('aria-expanded', open);
    accordionTrigger.classList.toggle('open', open);
  });

  const activityEvents = ['mousedown', 'keydown', 'wheel', 'touchstart'];
  activityEvents.forEach((ev) => document.addEventListener(ev, onUserActivity));
  let lastMoveActivity = 0;
  document.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMoveActivity > 2000) {
      lastMoveActivity = now;
      onUserActivity();
    }
  });

  updateUI(true, { skipFit: true });

  explorationIdleTimer = setTimeout(startExploration, IDLE_MS);
}

init().catch((err) => {
  const el = document.getElementById('globeViz');
  el.classList.remove('preload');
  el.innerHTML = `<div class="loading error">Failed to load: ${err.message}</div>`;
});
