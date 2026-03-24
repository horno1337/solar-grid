// ── Grid Zones ──────────────────────────────────────────────────────────────
export type GridZone = 'West' | 'North' | 'NorthEast' | 'East' | 'Central' | 'South' | 'SouthEast';

// ── Decision ────────────────────────────────────────────────────────────────
export type DecisionAction = 'sell' | 'consume' | 'neutral';

export interface DecisionResult {
	action: DecisionAction;
	/** Positive = sell favoured, negative = consume favoured */
	score: number;
	generationKwh: number;
	spotPricePln: number;        // PLN / MWh
	sellRevenuePln: number;
	consumeValuePln: number;
	solarGridSharePct: number;
	congestionPenaltyPct: number;
	batteryBonusPln: number;
	confidence: string;
}

// ── Region ──────────────────────────────────────────────────────────────────
export interface RegionConfig {
	id: string;
	name: string;
	lat: number;
	lon: number;
	/** Base average daily irradiance kWh/m²/day */
	baseIrradiance: number;
	gridZone: GridZone;
}

// ── Prosumer settings (user-controlled) ─────────────────────────────────────
export interface ProsumerSettings {
	/** Installed peak capacity in kWp */
	capacityKwp: number;
	/** Battery storage in kWh */
	batteryKwh: number;
	/** Net-billing prosumer tariff rate PLN/kWh */
	tariffPlnPerKwh: number;
}

// ── Market snapshot at a given hour ─────────────────────────────────────────
export interface MarketSnapshot {
	hour: number;            // 0–23
	spotPricePln: number;    // PLN/MWh
	gridLoadMw: number;
	nationalSolarMw: number;
}

// ── Weather snapshot for a single hour at a specific location ───────────────
// All values come directly from the Open-Meteo API response.
// We store one WeatherSnapshot per hour, per region, in a 24-element array.
export interface WeatherSnapshot {
	/** Direct beam radiation hitting the panel surface (W/m²).
	 *  This is the most important field — it's the "strong direct sunlight" component. */
	directRadiationWm2: number;

	/** Diffuse sky radiation — scattered light from clouds and atmosphere (W/m²).
	 *  Even on overcast days this contributes meaningfully (typically 50–150 W/m²). */
	diffuseRadiationWm2: number;

	/** Cloud cover as a percentage 0–100.
	 *  We use this as a secondary signal to cross-check radiation values
	 *  and to display a weather overlay on the map. */
	cloudCoverPct: number;

	/** Air temperature 2 metres above ground (°C).
	 *  Panels lose ~0.4% of output per °C above 25°C (temperature coefficient).
	 *  On a 40°C summer day that's a 6% efficiency hit — worth modelling. */
	temperature2mC: number;

	/** Precipitation in mm — used for soiling loss estimation.
	 *  Rain actually cleans panels, so heavy rain slightly improves next-hour output. */
	precipitationMm: number;

	/** The hour this snapshot belongs to (0–23), kept here for convenience
	 *  so we can look up a snapshot without needing the array index. */
	hour: number;
}

// ── A full 24-hour weather forecast for one region ──────────────────────────
// This is what gets stored in the app's weather cache.
export interface RegionWeatherForecast {
	regionId: string;
	/** Unix timestamp (ms) of when this forecast was fetched.
	 *  We use this to decide whether to re-fetch (max once per hour). */
	fetchedAt: number;
	hourly: WeatherSnapshot[]; // always 24 elements, index = hour of day
}

// ── App state ────────────────────────────────────────────────────────────────
export interface AppState {
	currentHour: number;
	selectedRegionId: string | null;
	settings: ProsumerSettings;
	/** Small simulated live drift applied on top of base price series */
	tickDrift: number;
	/** Weather forecasts keyed by region ID — populated lazily as user clicks regions */
	weatherCache: Record<string, RegionWeatherForecast>;
	/** Whether real weather data is available or we're falling back to simulation */
	weatherMode: 'live' | 'simulated';
	weatherLoading: string | null;
}