import type { MarketSnapshot } from '../types/index.js';
import { BASE_PRICES, BASE_LOAD, BASE_NATIONAL_SOLAR } from '../data/regions.js';

// ── Constants ────────────────────────────────────────────────────────────────
// Poland's bidding zone in the ENTSO-E system. This is the identifier
// the API uses to know which country's prices you're asking for.
const POLAND_DOMAIN = '10YPL-AREA-----S';
const ENTSO_BASE    = 'https://web-api.tp.entsoe.eu/api';

// Approximate EUR → PLN exchange rate.
// In Phase 5+ this could be fetched live from NBP (api.nbp.pl) but
// a fixed rate is accurate enough for now — it rarely swings more than 5%.
const EUR_TO_PLN = 4.25;

// ── Date helpers ─────────────────────────────────────────────────────────────
// ENTSO-E expects dates in the format YYYYMMDDHHmm in UTC.
// For day-ahead prices we always request today 00:00 → 23:00 UTC.
function formatEntsoeDate(date: Date): string {
  const y  = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(date.getUTCDate()).padStart(2, '0');
  const h  = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}${mo}${d}${h}${mi}`;
}

function getTodayRange(): { start: string; end: string } {
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0));
  return { start: formatEntsoeDate(start), end: formatEntsoeDate(end) };
}

// ── XML parsing ───────────────────────────────────────────────────────────────
// ENTSO-E returns XML rather than JSON. The browser's built-in DOMParser
// handles this cleanly — we don't need any external library.
// The structure we care about looks like:
//   <TimeSeries>
//     <Period>
//       <Point><position>1</position><price.amount>85.42</price.amount></Point>
//       <Point><position>2</position><price.amount>79.11</price.amount></Point>
//       ... (24 points total)
//     </Period>
//   </TimeSeries>
function parseXmlPrices(xml: string): number[] {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, 'application/xml');

  // Each <Point> element represents one hour.
  // position 1 = hour 0 (midnight), position 24 = hour 23 (11pm).
  const points  = doc.querySelectorAll('Point');
  const prices  = new Array<number>(24).fill(0);

  points.forEach(point => {
    const position = parseInt(point.querySelector('position')?.textContent ?? '0', 10);
    const price    = parseFloat(point.querySelector('price\\.amount')?.textContent ?? '0');

    // Convert from EUR/MWh to PLN/MWh and store at the correct hour index.
    // Position is 1-based in the XML, our array is 0-based.
    if (position >= 1 && position <= 24) {
      prices[position - 1] = price * EUR_TO_PLN;
    }
  });

  return prices;
}

// ── Main fetch function ───────────────────────────────────────────────────────
// Fetches today's 24 hourly prices from ENTSO-E and returns them as
// a plain number[] indexed by hour (0 = midnight, 23 = 11pm).
// Throws if the API is unreachable or returns an error document.
export async function fetchDayAheadPrices(): Promise<number[]> {
  // Vite exposes VITE_* env variables via import.meta.env at build time.
  const token = import.meta.env['VITE_ENTSO_TOKEN'] as string | undefined;

  if (!token) {
    throw new Error('VITE_ENTSO_TOKEN is not set in your .env file');
  }

  const { start, end } = getTodayRange();

  const url = new URL(ENTSO_BASE);
  url.searchParams.set('securityToken', token);
  url.searchParams.set('documentType',  'A44');
  url.searchParams.set('in_Domain',     POLAND_DOMAIN);
  url.searchParams.set('out_Domain',    POLAND_DOMAIN);
  url.searchParams.set('periodStart',   start);
  url.searchParams.set('periodEnd',     end);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`ENTSO-E API error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  // ENTSO-E returns an <Acknowledgement_MarketDocument> with a <Reason>
  // element when something goes wrong (invalid token, quota exceeded etc.)
  if (xml.includes('Acknowledgement_MarketDocument')) {
    const reason = new DOMParser()
      .parseFromString(xml, 'application/xml')
      .querySelector('text')?.textContent ?? 'Unknown error';
    throw new Error(`ENTSO-E rejected the request: ${reason}`);
  }

  return parseXmlPrices(xml);
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Day-ahead prices are published once per day (typically around 13:00 CET)
// and don't change after that. So we only need to fetch once per session
// and can cache the result in memory for the lifetime of the page.
let cachedPrices: number[] | null = null;

export async function getPrices(): Promise<number[]> {
  if (cachedPrices) return cachedPrices;

  try {
    cachedPrices = await fetchDayAheadPrices();
    return cachedPrices;
  } catch (err) {
    console.warn('ENTSO-E price fetch failed, using simulated prices.', err);
    return [...BASE_PRICES]; // fall back to simulation
  }
}

// ── Snapshot builder ──────────────────────────────────────────────────────────
// This is a drop-in replacement for buildSnapshot() from data/regions.ts.
// It has the same signature and return type — MarketSnapshot — so swapping
// it in requires no changes to the decision engine or map rendering code.
export async function buildLiveSnapshot(hour: number): Promise<MarketSnapshot> {
  const prices = await getPrices();

  return {
    hour,
    spotPricePln:    prices[hour] ?? BASE_PRICES[hour],
    gridLoadMw:      BASE_LOAD[hour],           // still simulated — Phase 2b (PSE)
    nationalSolarMw: BASE_NATIONAL_SOLAR[hour], // still simulated — Phase 2b (PSE)
  };
}
