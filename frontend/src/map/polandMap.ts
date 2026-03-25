import type { AppState, MarketSnapshot } from '../types/index.js';
import { REGIONS } from '../data/regions.js';
import { computeDecision, decisionColor } from '../engine/decision.js';

// ── SVG path data for each voivodeship (simplified polygons) ──────────────
const REGION_PATHS: Record<string, string> = {
	ZP: 'M90 80 L210 70 L230 110 L220 160 L180 180 L120 170 L85 140 Z',
	PM: 'M210 70 L310 60 L340 90 L320 140 L270 160 L230 160 L220 110 Z',
	WM: 'M310 60 L430 50 L460 80 L450 150 L390 170 L340 160 L320 120 Z',
	PD: 'M430 50 L540 55 L560 100 L550 170 L470 190 L450 160 L460 100 Z',
	LB: 'M85 140 L120 170 L140 230 L110 280 L70 260 L60 200 Z',
	WP: 'M120 170 L230 160 L270 200 L260 280 L200 300 L140 280 L140 230 Z',
	KP: 'M230 160 L320 140 L360 180 L340 240 L270 250 L260 200 Z',
	MZ: 'M340 160 L450 150 L470 190 L480 280 L400 320 L340 300 L320 240 L360 200 Z',
	LD: 'M260 280 L340 260 L340 300 L320 360 L270 370 L220 340 L220 310 Z',
	DS: 'M110 280 L200 300 L220 340 L190 400 L130 420 L90 380 L85 310 Z',
	OP: 'M200 300 L260 300 L270 370 L240 410 L190 420 L190 380 L220 340 Z',
	SL: 'M270 370 L340 360 L380 390 L360 450 L290 460 L240 430 L240 410 Z',
	SK: 'M340 300 L400 320 L420 370 L380 410 L340 400 L320 370 L320 340 Z',
	MA: 'M340 400 L380 410 L420 400 L450 440 L430 500 L360 510 L300 490 L290 460 L360 450 Z',
	PK: 'M420 370 L480 340 L530 380 L540 450 L490 510 L430 510 L430 460 L450 440 L420 400 Z',
	LU: 'M400 280 L480 280 L550 300 L530 380 L480 370 L420 390 L400 370 L380 340 Z',
};

// ── Label positions (centroid approximations) ─────────────────────────────
const REGION_LABELS: Record<string, [number, number]> = {
	ZP: [150, 135], PM: [270, 115], WM: [385, 110], PD: [490, 115],
	LB: [88, 215], WP: [195, 240], KP: [290, 205], MZ: [405, 240],
	LD: [285, 330], DS: [155, 360], OP: [225, 360], SL: [308, 420],
	SK: [368, 358], MA: [368, 465], PK: [478, 435], LU: [460, 330],
};

export type RegionClickHandler = (id: string) => void;
export type RegionHoverHandler = (id: string, x: number, y: number) => void;
export type RegionLeaveHandler = () => void;

interface MapHandlers {
	onClick: RegionClickHandler;
	onHover: RegionHoverHandler;
	onLeave: RegionLeaveHandler;
}

/** Build the static SVG DOM (paths + labels).  Call once on init. */
export function buildMapSVG(
	container: HTMLElement,
	handlers: MapHandlers,
): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('id', 'map');
	svg.setAttribute('viewBox', '0 0 800 700');
	svg.style.width = '100%';
	svg.style.height = '100%';

	// Paths
	for (const [id, d] of Object.entries(REGION_PATHS)) {
		const path = document.createElementNS(ns, 'path');
		path.setAttribute('d', d);
		path.setAttribute('stroke', '#0a0e1a');
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('class', 'region');
		path.dataset['id'] = id;

		path.addEventListener('click', () => handlers.onClick(id));
		path.addEventListener('mousemove', (e: MouseEvent) =>
			handlers.onHover(id, e.clientX, e.clientY));
		path.addEventListener('mouseleave', () => handlers.onLeave());

		svg.appendChild(path);
	}

	// Labels
	const labelGroup = document.createElementNS(ns, 'g');
	labelGroup.setAttribute('font-family', 'Space Mono');
	labelGroup.setAttribute('font-size', '10');
	labelGroup.setAttribute('fill', 'rgba(255,255,255,0.6)');
	labelGroup.setAttribute('text-anchor', 'middle');
	labelGroup.setAttribute('pointer-events', 'none');

	for (const [id, [x, y]] of Object.entries(REGION_LABELS)) {
		const text = document.createElementNS(ns, 'text');
		text.setAttribute('x', String(x));
		text.setAttribute('y', String(y));
		text.textContent = id;
		labelGroup.appendChild(text);
	}
	svg.appendChild(labelGroup);

	container.appendChild(svg);
	return svg;
}

/** Update fill colours based on current app state.  Call on every tick. */
export function updateMapColors(svg: SVGSVGElement, state: AppState, snapshot: MarketSnapshot): void {
	svg.querySelectorAll<SVGPathElement>('.region').forEach(path => {
		const id = path.dataset['id'];
		if (!id || !REGIONS[id]) return;

		const weather = state.weatherCache[id]?.hourly[state.currentHour];
		const result = computeDecision(REGIONS[id], snapshot, state.settings, weather);
		path.style.fill = decisionColor(result);

		const isSelected = id === state.selectedRegionId;
		path.classList.toggle('selected', isSelected);
	});
}