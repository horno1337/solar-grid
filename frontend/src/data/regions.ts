import type { RegionConfig, MarketSnapshot } from '../types/index.js';

export const REGIONS: Record<string, RegionConfig> = {
	ZP: { id: 'ZP', name: 'Zachodniopomorskie', lat: 53.5, lon: 15.0, baseIrradiance: 3.4, gridZone: 'West' },
	PM: { id: 'PM', name: 'Pomorskie', lat: 54.2, lon: 18.6, baseIrradiance: 3.3, gridZone: 'North' },
	WM: { id: 'WM', name: 'Warmińsko-Mazurskie', lat: 53.8, lon: 20.8, baseIrradiance: 3.2, gridZone: 'NorthEast' },
	PD: { id: 'PD', name: 'Podlaskie', lat: 53.1, lon: 22.8, baseIrradiance: 3.35, gridZone: 'East' },
	LB: { id: 'LB', name: 'Lubuskie', lat: 51.9, lon: 15.5, baseIrradiance: 3.55, gridZone: 'West' },
	WP: { id: 'WP', name: 'Wielkopolskie', lat: 52.4, lon: 17.0, baseIrradiance: 3.6, gridZone: 'West' },
	KP: { id: 'KP', name: 'Kujawsko-Pomorskie', lat: 53.0, lon: 18.0, baseIrradiance: 3.5, gridZone: 'Central' },
	MZ: { id: 'MZ', name: 'Mazowieckie', lat: 52.2, lon: 21.0, baseIrradiance: 3.55, gridZone: 'Central' },
	LD: { id: 'LD', name: 'Łódzkie', lat: 51.8, lon: 19.5, baseIrradiance: 3.65, gridZone: 'Central' },
	DS: { id: 'DS', name: 'Dolnośląskie', lat: 51.0, lon: 16.5, baseIrradiance: 3.7, gridZone: 'South' },
	OP: { id: 'OP', name: 'Opolskie', lat: 50.7, lon: 17.9, baseIrradiance: 3.75, gridZone: 'South' },
	SL: { id: 'SL', name: 'Śląskie', lat: 50.3, lon: 19.0, baseIrradiance: 3.8, gridZone: 'South' },
	SK: { id: 'SK', name: 'Świętokrzyskie', lat: 50.9, lon: 20.6, baseIrradiance: 3.7, gridZone: 'Central' },
	MA: { id: 'MA', name: 'Małopolskie', lat: 49.9, lon: 20.5, baseIrradiance: 3.85, gridZone: 'South' },
	PK: { id: 'PK', name: 'Podkarpackie', lat: 50.0, lon: 22.5, baseIrradiance: 3.8, gridZone: 'SouthEast' },
	LU: { id: 'LU', name: 'Lubelskie', lat: 51.2, lon: 23.0, baseIrradiance: 3.6, gridZone: 'East' },
};

export const SOLAR_PROFILE: readonly number[] = [
	0, 0, 0, 0, 0, 0.02, 0.08, 0.18, 0.35, 0.55, 0.75, 0.90,
	0.95, 0.90, 0.80, 0.65, 0.45, 0.22, 0.08, 0.02, 0, 0, 0, 0,
] as const;

export const BASE_PRICES: readonly number[] = [
	180, 165, 155, 150, 148, 160, 195, 280, 340, 380, 360, 320,
	290, 275, 280, 310, 350, 420, 470, 430, 380, 310, 250, 200,
] as const;

export const BASE_LOAD: readonly number[] = [
	14500, 13800, 13200, 13000, 13100, 13900, 16000, 19500,
	22000, 23500, 23000, 22000, 21500, 21000, 21500, 22500,
	23800, 25000, 25500, 24500, 23000, 21000, 18500, 16000,
] as const;

export const BASE_NATIONAL_SOLAR: readonly number[] = SOLAR_PROFILE.map(f =>
	Math.round(f * 4_500),
) as unknown as readonly number[];

export function buildSnapshot(hour: number, drift: number): MarketSnapshot {
	return {
		hour,
		spotPricePln: BASE_PRICES[hour] + drift * Math.sin(hour) * 5,
		gridLoadMw: BASE_LOAD[hour] + drift * 50,
		nationalSolarMw: BASE_NATIONAL_SOLAR[hour] + drift * 10,
	};
}

export const AVERAGE_PRICE: number =
	BASE_PRICES.reduce((a, b) => a + b, 0) / BASE_PRICES.length;
