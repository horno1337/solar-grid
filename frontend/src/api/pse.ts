import { BASE_LOAD, BASE_NATIONAL_SOLAR } from '../data/regions.js';

// ── PSE OpenData API ──────────────────────────────────────────────────────────
// PSE (Polskie Sieci Elektroenergetyczne) publishes operational grid data
// at https://www.pse.pl/dane-systemowe with a ~15 minute publication delay.
// No authentication required — it's public data by legal mandate.
//
// The endpoint we use returns current national load and generation mix as JSON.
// Documentation: https://www.pse.pl/dane-systemowe/funkcjonowanie-kse/raporty-biezace-kse

const PSE_BASE = 'https://api.pse.pl/v1';

// This is the shape of a single row in PSE's generation data response.
// PSE returns an array of these, one per 15-minute interval.
interface PseGenerationRow {
  CIM_OZNACZENIE_CZASOWE: string; // ISO timestamp e.g. "2024-06-01T12:00:00"
  LOAD:                   number; // Total national load in MW
  PV:                     number; // Solar PV generation in MW
  WIND_ON:                number; // Onshore wind in MW
  WIND_OFF:               number; // Offshore wind in MW
}

interface PseResponse {
  value: PseGenerationRow[];
}

// ── Fetch current grid state ───────────────────────────────────────────────────
// Returns the most recent available data point from PSE.
// Because PSE publishes with a ~15 minute delay, "current" means
// the last completed 15-minute interval.
export async function fetchCurrentGridState(): Promise<{ loadMw: number; solarMw: number }> {
  // Request today's data — PSE uses date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  const url   = `${PSE_BASE}/PL_GEN_MOC_JW_EPS?$filter=DOBA eq '${today}'&$orderby=CIM_OZNACZENIE_CZASOWE desc&$top=1`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`PSE API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as PseResponse;

  if (!data.value || data.value.length === 0) {
    throw new Error('PSE returned empty dataset');
  }

  const latest = data.value[0];

  return {
    loadMw:  latest.LOAD,
    solarMw: latest.PV,
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Grid state changes every 15 minutes so we refresh the cache on the same
// interval. Stale data older than 15 minutes triggers a background re-fetch.
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

interface GridCache {
  loadMw:    number;
  solarMw:   number;
  fetchedAt: number;
}

let gridCache: GridCache | null = null;

export async function getGridState(): Promise<{ loadMw: number; solarMw: number }> {
  const now = Date.now();

  // Return cached value if it's still fresh
  if (gridCache && now - gridCache.fetchedAt < FIFTEEN_MINUTES_MS) {
    return { loadMw: gridCache.loadMw, solarMw: gridCache.solarMw };
  }

  try {
    const state = await fetchCurrentGridState();
    gridCache = { ...state, fetchedAt: now };
    return state;
  } catch (err) {
    console.warn('PSE grid fetch failed, using simulated load.', err);
    // Fall back to simulated data for the current hour
    const hour = new Date().getHours();
    return {
      loadMw:  BASE_LOAD[hour],
      solarMw: BASE_NATIONAL_SOLAR[hour],
    };
  }
}
