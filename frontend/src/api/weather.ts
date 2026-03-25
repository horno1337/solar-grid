import type { WeatherSnapshot, RegionWeatherForecast } from '../types/index.js';

// ── Open-Meteo API ───────────────────────────────────────────────────────────
// Free, no API key required, returns JSON directly.
// Docs: https://open-meteo.com/en/docs
//
// We request hourly data for the current day for a given lat/lon.
// The response looks like:
// {
//   "hourly": {
//     "time": ["2024-06-01T00:00", "2024-06-01T01:00", ...],  // 24 entries
//     "direct_radiation": [0, 0, 0, 12, 45, ...],
//     "diffuse_radiation": [0, 0, 0, 8, 22, ...],
//     "cloud_cover": [80, 75, 70, 60, ...],
//     "temperature_2m": [14.2, 13.8, ...],
//     "precipitation": [0, 0, 0.1, ...]
//   }
// }

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// These are the exact field names Open-Meteo expects in the `hourly` parameter.
const HOURLY_FIELDS = [
	'direct_radiation',
	'diffuse_radiation',
	'cloud_cover',
	'temperature_2m',
	'precipitation',
].join(',');

// The shape of the raw JSON we get back from Open-Meteo.
// We type this loosely since it comes from an external API we don't control.
interface OpenMeteoResponse {
	hourly: {
		time: string[];
		direct_radiation: number[];
		diffuse_radiation: number[];
		cloud_cover: number[];
		temperature_2m: number[];
		precipitation: number[];
	};
}

// ── Main fetch function ──────────────────────────────────────────────────────
// Fetches a full 24-hour forecast for a given coordinate.
// Returns a RegionWeatherForecast ready to drop into the app's weather cache.
//
// We only request `forecast_days=1` (today only) — this keeps the response
// small and fast. When we get to the ML phase we'll extend this to 2–3 days
// so the model has future context to reason about.
export async function fetchWeatherForecast(
	regionId: string,
	lat: number,
	lon: number,
): Promise<RegionWeatherForecast> {
	const url = new URL(BASE_URL);

	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('hourly', HOURLY_FIELDS);
	url.searchParams.set('forecast_days', '1');
	url.searchParams.set('timezone', 'Europe/Warsaw'); // ensures hours match Polish local time

	const response = await fetch(url.toString());

	if (!response.ok) {
		throw new Error(
			`Open-Meteo request failed for region ${regionId}: ${response.status} ${response.statusText}`
		);
	}

	const data: OpenMeteoResponse = await response.json() as OpenMeteoResponse;

	// Parse the flat arrays from the API into our structured WeatherSnapshot objects.
	// The API always returns exactly 24 entries when forecast_days=1.
	const hourly: WeatherSnapshot[] = data.hourly.time.map((timeStr, i) => {
		// timeStr looks like "2024-06-01T14:00" — we extract the hour from it.
		const hour = new Date(timeStr).getHours();

		return {
			hour,
			directRadiationWm2: data.hourly.direct_radiation[i] ?? 0,
			diffuseRadiationWm2: data.hourly.diffuse_radiation[i] ?? 0,
			cloudCoverPct: data.hourly.cloud_cover[i] ?? 0,
			temperature2mC: data.hourly.temperature_2m[i] ?? 15,
			precipitationMm: data.hourly.precipitation[i] ?? 0,
		};
	});

	return {
		regionId,
		fetchedAt: Date.now(),
		hourly,
	};
}

// ── Cache helpers ────────────────────────────────────────────────────────────
// This checks whether a cached forecast is still fresh enough to use.
// "Fresh" means fetched within the last hour — weather data doesn't change
// minute-to-minute, so re-fetching hourly is more than sufficient.
const ONE_HOUR_MS = 60 * 60 * 1000;

export function isForecastFresh(forecast: RegionWeatherForecast): boolean {
	return Date.now() - forecast.fetchedAt < ONE_HOUR_MS;
}

// ── Fallback ─────────────────────────────────────────────────────────────────
import { SOLAR_PROFILE } from '../data/regions.js';

export function buildFallbackForecast(regionId: string): RegionWeatherForecast {
	const hourly: WeatherSnapshot[] = SOLAR_PROFILE.map((fraction, hour) => ({
		hour,
		// Convert the 0–1 fraction to a plausible W/m² value.
		// Peak solar irradiance at the surface is roughly 800 W/m² on a clear day.
		directRadiationWm2: fraction * 700,
		diffuseRadiationWm2: fraction * 100,
		cloudCoverPct: 20, // assume a mostly-clear day as default
		temperature2mC: 15 + fraction * 12, // warms up during the day
		precipitationMm: 0,
	}));

	return {
		regionId,
		fetchedAt: Date.now(),
		hourly,
	};
}