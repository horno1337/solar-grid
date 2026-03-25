import type { AppState, DecisionResult, MarketSnapshot, WeatherSnapshot } from '../types/index.js';
import { REGIONS, buildSnapshot } from '../data/regions.js';
import { computeDecision, computeGeneration, effectiveIrradianceFromWeather, effectiveIrradianceStatic } from '../engine/decision.js';

// ── Weather helper ────────────────────────────────────────────────────────────
// Looks up the cached WeatherSnapshot for a region at the current hour.
// Returns undefined if no weather data is cached yet (first load / API failed).
function getWeather(state: AppState, regionId: string): WeatherSnapshot | undefined {
	return state.weatherCache[regionId]?.hourly[state.currentHour];
}

// ── Header stats ──────────────────────────────────────────────────────────────
export function updateHeader(state: AppState, snap: MarketSnapshot): void {
	const bal = snap.nationalSolarMw - snap.gridLoadMw * 0.05;

	setText('h-price', snap.spotPricePln.toFixed(0));
	setText('h-load', (snap.gridLoadMw / 1_000).toFixed(1) + ' GW');
	setText('h-solar', snap.nationalSolarMw.toFixed(0));

	const balEl = document.getElementById('h-balance');
	if (balEl) {
		balEl.textContent = (bal >= 0 ? '+' : '') + bal.toFixed(0) + ' MW';
		balEl.style.color = bal >= 0 ? 'var(--sell)' : 'var(--red)';
	}

	// Show live vs simulated badge
	const badgeEl = document.querySelector<HTMLElement>('.live-badge');
	if (badgeEl) {
		badgeEl.style.color = state.weatherMode === 'live' ? 'var(--consume)' : 'var(--dim)';
		const dot = badgeEl.querySelector<HTMLElement>('.live-dot');
		if (dot) dot.style.background = state.weatherMode === 'live' ? 'var(--consume)' : 'var(--dim)';
		const text = badgeEl.childNodes[1];
		if (text) text.textContent = state.weatherMode === 'live' ? ' Live Weather' : ' Simulated';
	}
}

// ── Region detail card ────────────────────────────────────────────────────────
const ICONS: Record<DecisionResult['action'], string> = { sell: '💰', consume: '🔋', neutral: '⚖️' };
const LABELS: Record<DecisionResult['action'], string> = {
	sell: 'SELL TO GRID',
	consume: 'SELF-CONSUME',
	neutral: 'HOLD / NEUTRAL',
};

export function renderRegionCard(state: AppState, snap: MarketSnapshot): void {
	const card = document.getElementById('region-card');
	if (!card) return;

	const id = state.selectedRegionId;
	if (!id) {
		card.innerHTML = `
      <div class="empty-state">
        <div class="arrow">↑</div>
        <p>Click any voivodeship on the map to see the real-time<br>sell vs. consume analysis for that region.</p>
      </div>`;
		return;
	}

	const region = REGIONS[id];
	const weather = getWeather(state, id);
	const result = computeDecision(region, snap, state.settings, weather);
	const { settings, currentHour } = state;

	// Irradiance displayed depends on whether we have real weather data
	const irrDisplay = weather
		? effectiveIrradianceFromWeather(weather).toFixed(3)
		: effectiveIrradianceStatic(region, currentHour).toFixed(3);

	// Weather detail line — shown when real data is available
	const weatherLine = weather
		? `☁ ${weather.cloudCoverPct.toFixed(0)}% cloud · ` +
		`${weather.temperature2mC.toFixed(1)}°C · ` +
		`${(weather.directRadiationWm2 + weather.diffuseRadiationWm2).toFixed(0)} W/m²`
		: 'Fetching weather data…';

	card.innerHTML = `
    <div class="region-name">${region.name}</div>
    <div class="region-voivodeship">
      Grid Zone: ${region.gridZone} · ${currentHour}:00
      <span style="margin-left:8px;color:${weather ? 'var(--consume)' : 'var(--dim)'}">
        ${weather ? '● Live weather' : '○ Simulated'}
      </span>
    </div>

    <div class="weather-line" style="font-size:0.75rem;color:var(--dim);margin-bottom:16px;font-family:'Space Mono',monospace;">
      ${weatherLine}
    </div>

    <div class="decision-banner ${result.action}">
      <div class="decision-icon">${ICONS[result.action]}</div>
      <div class="decision-text">
        <div class="decision-action ${result.action}">${LABELS[result.action]}</div>
        <div class="decision-sub">${result.confidence}</div>
      </div>
    </div>

    <div class="metrics-grid">
      ${metric('Generation', result.generationKwh.toFixed(2) + ' kWh', 'info')}
      ${metric('Spot Price', result.spotPricePln.toFixed(0) + ' PLN/MWh',
		result.spotPricePln > 300 ? 'positive' : 'negative')}
      ${metric('Sell Revenue', result.sellRevenuePln.toFixed(2) + ' PLN', 'positive')}
      ${metric('Self-consume Value', result.consumeValuePln.toFixed(2) + ' PLN', 'info')}
      ${metric('Solar Grid Share', result.solarGridSharePct.toFixed(1) + '%',
			result.solarGridSharePct > 15 ? 'negative' : 'info')}
      ${metric('Decision Score', (result.score >= 0 ? '+' : '') + result.score.toFixed(3),
				result.score > 0 ? 'positive' : 'negative')}
    </div>

    <div class="math-block">
<span class="formula-line">── Math Breakdown ──────────────</span>
Gen  = ${settings.capacityKwp} kWp × ${irrDisplay} irr × 0.18
     = ${result.generationKwh.toFixed(3)} kWh

Sell = ${result.generationKwh.toFixed(3)} kWh × ${result.spotPricePln.toFixed(0)} PLN/MWh ÷ 1000
     - congestion: ${result.congestionPenaltyPct.toFixed(1)}%
     = ${result.sellRevenuePln.toFixed(3)} PLN

Save = ${result.generationKwh.toFixed(3)} kWh × ${settings.tariffPlnPerKwh.toFixed(2)} PLN/kWh
     = ${result.consumeValuePln.toFixed(3)} PLN

<span class="result-line">Net Δ = ${result.score.toFixed(3)} PLN → ${result.action.toUpperCase()}</span>
    </div>

    <div class="price-chart-wrap">
      <div class="section-title" style="margin-top:14px;margin-bottom:8px">24h Spot Price + Generation</div>
      <canvas id="price-canvas" width="260" height="90"></canvas>
    </div>
  `;

	requestAnimationFrame(() => drawSparkline(state, id));
}

// ── 24h Sparkline ─────────────────────────────────────────────────────────────
function drawSparkline(state: AppState, regionId: string): void {
	const canvas = document.getElementById('price-canvas') as HTMLCanvasElement | null;
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const W = canvas.offsetWidth || 260;
	const H = 90;
	canvas.width = W;
	canvas.height = H;
	ctx.clearRect(0, 0, W, H);

	const priceData = Array.from({ length: 24 }, (_, h) =>
		buildSnapshot(h, state.tickDrift).spotPricePln);

	// Use real weather data for the sparkline generation curve if available,
	// otherwise fall back to static profile
	const genData = Array.from({ length: 24 }, (_, h) => {
		const w = state.weatherCache[regionId]?.hourly[h];
		return computeGeneration(REGIONS[regionId], h, state.settings.capacityKwp, w);
	});

	const maxP = Math.max(...priceData), minP = Math.min(...priceData);
	const maxG = Math.max(...genData);

	// Grid lines
	ctx.strokeStyle = 'rgba(30,42,69,0.8)';
	ctx.lineWidth = 1;
	[0.25, 0.5, 0.75].forEach(y => {
		ctx.beginPath();
		ctx.moveTo(0, y * H);
		ctx.lineTo(W, y * H);
		ctx.stroke();
	});

	// Generation area (green)
	if (maxG > 0) {
		const gGrad = ctx.createLinearGradient(0, 0, 0, H);
		gGrad.addColorStop(0, 'rgba(59,232,176,0.25)');
		gGrad.addColorStop(1, 'rgba(59,232,176,0.02)');
		ctx.beginPath();
		genData.forEach((g, i) => {
			const x = (i / 23) * W;
			const y = H - (g / maxG) * (H - 8) - 4;
			i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		});
		ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
		ctx.fillStyle = gGrad;
		ctx.fill();
	}

	// Price area (yellow)
	const pGrad = ctx.createLinearGradient(0, 0, 0, H);
	pGrad.addColorStop(0, 'rgba(240,192,64,0.3)');
	pGrad.addColorStop(1, 'rgba(240,192,64,0.02)');
	ctx.beginPath();
	priceData.forEach((p, i) => {
		const x = (i / 23) * W;
		const y = H - ((p - minP) / (maxP - minP)) * (H - 8) - 4;
		i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	});
	ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
	ctx.fillStyle = pGrad;
	ctx.fill();

	// Price line
	ctx.beginPath();
	ctx.strokeStyle = '#f0c040';
	ctx.lineWidth = 2;
	priceData.forEach((p, i) => {
		const x = (i / 23) * W;
		const y = H - ((p - minP) / (maxP - minP)) * (H - 8) - 4;
		i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	});
	ctx.stroke();

	// Current hour marker
	const cx = (state.currentHour / 23) * W;
	const cy = H - ((priceData[state.currentHour] - minP) / (maxP - minP)) * (H - 8) - 4;
	ctx.beginPath();
	ctx.arc(cx, cy, 5, 0, Math.PI * 2);
	ctx.fillStyle = '#f0c040';
	ctx.fill();
	ctx.strokeStyle = '#0a0e1a';
	ctx.lineWidth = 2;
	ctx.stroke();
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
export function showTooltip(regionId: string, x: number, y: number, state: AppState, snap: MarketSnapshot): void {
	const tip = document.getElementById('tooltip');
	if (!tip) return;
	const weather = getWeather(state, regionId);
	const result = computeDecision(REGIONS[regionId], snap, state.settings, weather);
	const labels: Record<DecisionResult['action'], string> = {
		sell: '💰 Sell to grid',
		consume: '🔋 Self-consume',
		neutral: '⚖️ Neutral',
	};

	tip.style.display = 'block';
	tip.style.left = `${x + 14}px`;
	tip.style.top = `${y - 40}px`;

	const nameEl = tip.querySelector<HTMLElement>('.tt-name');
	const actEl = tip.querySelector<HTMLElement>('.tt-action');
	if (nameEl) nameEl.textContent = REGIONS[regionId].name;
	if (actEl) {
		actEl.className = `tt-action ${result.action}`;
		actEl.textContent = `${labels[result.action]} · ${snap.spotPricePln.toFixed(0)} PLN/MWh`;
	}
}

export function hideTooltip(): void {
	const tip = document.getElementById('tooltip');
	if (tip) tip.style.display = 'none';
}

// ── Time buttons ──────────────────────────────────────────────────────────────
export function buildTimeBar(onSelect: (hour: number) => void): void {
	const bar = document.getElementById('time-bar');
	if (!bar) return;
	bar.innerHTML = '';
	for (let h = 0; h < 24; h += 3) {
		const btn = document.createElement('button');
		btn.className = 'time-btn';
		btn.textContent = String(h).padStart(2, '0') + ':00';
		btn.dataset['hour'] = String(h);
		btn.addEventListener('click', () => onSelect(h));
		bar.appendChild(btn);
	}
}

export function syncTimeButtons(currentHour: number): void {
	document.querySelectorAll<HTMLButtonElement>('.time-btn').forEach(btn => {
		const h = Number(btn.dataset['hour']);
		btn.classList.toggle('active', Math.floor(currentHour / 3) * 3 === h);
	});
}

// ── Slider wiring ─────────────────────────────────────────────────────────────
export function wireSliders(
	onChange: (key: 'capacityKwp' | 'batteryKwh' | 'tariffPlnPerKwh', value: number) => void,
): void {
	wireSlider('cap-slider', 'cap-val', v => ({ label: `${v} kWp`, out: v }),
		v => onChange('capacityKwp', v));
	wireSlider('bat-slider', 'bat-val', v => ({ label: `${v} kWh`, out: v }),
		v => onChange('batteryKwh', v));
	wireSlider('tariff-slider', 'tariff-val', v => ({ label: `${(v / 100).toFixed(2)} PLN`, out: v / 100 }),
		v => onChange('tariffPlnPerKwh', v));
}

function wireSlider(
	sliderId: string,
	labelId: string,
	transform: (raw: number) => { label: string; out: number },
	cb: (value: number) => void,
): void {
	const slider = document.getElementById(sliderId) as HTMLInputElement | null;
	const label = document.getElementById(labelId);
	if (!slider || !label) return;

	slider.addEventListener('input', () => {
		const { label: lbl, out } = transform(Number(slider.value));
		label.textContent = lbl;
		cb(out);
	});
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function setText(id: string, text: string): void {
	const el = document.getElementById(id);
	if (el) el.textContent = text;
}

function metric(label: string, value: string, cls: 'positive' | 'negative' | 'info'): string {
	return `
    <div class="metric-box">
      <div class="metric-box-label">${label}</div>
      <div class="metric-box-val ${cls}">${value}</div>
    </div>`;
}