import type { AppState, MarketSnapshot } from './types/index.js';
import { REGIONS, buildSnapshot } from './data/regions.js';
import { buildMapSVG, updateMapColors } from './map/polandMap.js';
import {
	updateHeader,
	renderRegionCard,
	showTooltip,
	hideTooltip,
	buildTimeBar,
	syncTimeButtons,
	wireSliders,
} from './ui/sidebar.js';
import {
	fetchWeatherForecast,
	isForecastFresh,
	buildFallbackForecast,
} from './api/weather.js';
import { buildLiveSnapshot } from './api/entso.js';
import { getGridState } from './api/pse.js';
import { warmPredictionCache } from './engine/irradianceModel.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state: AppState = {
	currentHour: new Date().getHours(),
	selectedRegionId: null,
	tickDrift: 0,
	weatherCache: {},
	weatherMode: 'simulated',
	weatherLoading: null,
	settings: {
		capacityKwp: 10,
		batteryKwh: 5,
		tariffPlnPerKwh: 0.70,
	},
};

// ── Live market data ──────────────────────────────────────────────────────────
// We keep a module-level snapshot so renderAll() can remain synchronous
// (important for the animation tick) while the data is refreshed
// asynchronously in the background.
let currentSnapshot: MarketSnapshot = buildSnapshot(
	state.currentHour,
	state.tickDrift,
);

async function refreshMarketData(): Promise<void> {
	const [snap, grid] = await Promise.all([
		buildLiveSnapshot(state.currentHour),
		getGridState(),
	]);

	// Merge the live grid state into the snapshot from ENTSO-E
	currentSnapshot = {
		...snap,
		gridLoadMw: grid.loadMw,
		nationalSolarMw: grid.solarMw,
	};

	renderAll();
}

// ── SVG reference — set once in init(), used everywhere ──────────────────────
let svg: SVGSVGElement;

// ── Render — module-level so all async code can call it ───────────────────────
function renderAll(): void {
	updateMapColors(svg, state, currentSnapshot);
	updateHeader(state, currentSnapshot);
	renderRegionCard(state, currentSnapshot);
}

// ── Weather fetching ──────────────────────────────────────────────────────────
// Fetches lazily (only on region click) and caches for one hour.
// Falls back to simulated data if the API is unreachable.
async function ensureWeatherForRegion(regionId: string): Promise<void> {
	const existing = state.weatherCache[regionId];
	if (existing && isForecastFresh(existing)) return;

	// Mark this region as "loading" so the UI can show a spinner
	state.weatherLoading = regionId;
	renderAll();

	const region = REGIONS[regionId];

	try {
		const forecast = await fetchWeatherForecast(regionId, region.lat, region.lon);
		state.weatherCache[regionId] = forecast;
		void warmPredictionCache(regionId, region.lat, forecast.hourly);
		state.weatherMode = 'live';
	} catch (err) {
		console.warn(`Weather fetch failed for ${regionId}, using fallback.`, err);
		state.weatherCache[regionId] = buildFallbackForecast(regionId);
		state.weatherMode = 'simulated';
	}

	state.weatherLoading = null;
	renderAll();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
function init(): void {
	const mapContainer = document.getElementById('map-container');
	if (!mapContainer) throw new Error('#map-container not found');

	svg = buildMapSVG(mapContainer, {
		onClick: (id) => {
			state.selectedRegionId = id;
			renderAll();
			void ensureWeatherForRegion(id);
		},
		onHover: (id, x, y) => showTooltip(id, x, y, state, currentSnapshot),
		onLeave: hideTooltip,
	});

	buildTimeBar((hour) => {
		state.currentHour = hour;
		syncTimeButtons(hour);
		renderAll();
	});
	syncTimeButtons(state.currentHour);

	wireSliders((key, value) => {
		state.settings = { ...state.settings, [key]: value };
		renderAll();
	});

	renderAll();

	// Fetch live market data immediately, then refresh every 15 minutes
	void refreshMarketData();
	setInterval(() => { void refreshMarketData(); }, 15 * 60 * 1_000);

	// Visual drift tick — keeps the UI lively between data refreshes
	setInterval(() => {
		state.tickDrift += (Math.random() - 0.45) * 0.8;
		state.tickDrift = Math.max(-8, Math.min(8, state.tickDrift));
		renderAll();
	}, 2_000);
}

document.addEventListener('DOMContentLoaded', init);
