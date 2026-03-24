import type { AppState } from './types/index.js';
import { REGIONS } from './data/regions.js';
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

// ── SVG reference — set once in init(), used everywhere ──────────────────────
let svg: SVGSVGElement;

// ── Render — module-level so all async code can call it ───────────────────────
function renderAll(): void {
	updateMapColors(svg, state);
	updateHeader(state);
	renderRegionCard(state);
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
		onHover: (id, x, y) => showTooltip(id, x, y, state),
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

	setInterval(() => {
		state.tickDrift += (Math.random() - 0.45) * 0.8;
		state.tickDrift = Math.max(-8, Math.min(8, state.tickDrift));
		renderAll();
	}, 2_000);
}

document.addEventListener('DOMContentLoaded', init);