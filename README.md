# SolarGrid PL 🌤️

> Real-time solar energy decision map for Polish prosumers — should you sell your energy to the grid, or consume it yourself?

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python)
![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?style=flat-square&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=flat-square)

**[→ Live demo](https://horno1337.github.io/solar-grid/)** — market data simulated, weather & ML models are live

---

## What is this?

Since 2022, Polish solar panel owners (called **prosumers**) operate under a net-billing system — they can either consume the electricity their panels generate, or sell it back to the grid at the current spot price. The right choice changes throughout the day depending on weather conditions, grid load, and market prices.

I built an interactive map that answers that question in real time, for every voivodeship in Poland simultaneously. It fetches live atmospheric data from Open-Meteo, runs a machine learning model to estimate solar generation, pulls day-ahead prices from ENTSO-E, and colors each region based on whether selling or self-consuming makes more financial sense right now.

---

## How it works

The decision engine runs this calculation for each region and each hour:

```
generation (kWh) = capacity × ML_irradiance(weather) × panel_efficiency

sell_revenue  = generation × spot_price (PLN/MWh) ÷ 1000 − congestion_penalty
consume_value = generation × prosumer_tariff (PLN/kWh)

score = sell_revenue − consume_value
```

Positive score → sell. Negative → self-consume. Within ±0.05 PLN → neutral, not worth acting on.

The **congestion penalty** kicks in when solar covers more than 15% of national grid load — at that point wholesale prices drop non-linearly (merit-order effect) and the engine discounts the effective sell price accordingly.

The **temperature correction** accounts for the ~0.4% efficiency loss per °C above 25°C that most calculators skip.

---

## Machine learning

Two LightGBM models run entirely in the browser — no server needed at inference time.

**Irradiance model** — predicts effective solar generation from real-time weather features (direct radiation, diffuse radiation, cloud cover, temperature, precipitation, time encoding, latitude). Trained on 12 months of hourly data across all 16 voivodeships.

| MAE | R² | Relative error |
|-----|----|----------------|
| 0.0036 kWh/m² | 0.9991 | 1.9% |

Solar irradiance follows stable physics, so this one works well.

**Price forecasting model** — predicts Polish day-ahead spot prices (PLN/MWh) at 1h, 3h, and 6h horizons using lag features, rolling statistics, and cyclical time encoding.

| Horizon | MAE | R² |
|---------|-----|----|
| 1h ahead | 148.7 PLN/MWh | 0.10 |
| 3h ahead | 148.8 PLN/MWh | 0.11 |
| 6h ahead | 151.4 PLN/MWh | 0.11 |

Electricity prices are genuinely hard to forecast — driven by plant outages, weather shocks, and cross-border flows that lag features can't anticipate. The model captures structural patterns (morning/evening peaks, weekend discounts, seasonality) but not short-term volatility. It's displayed as a historical pattern overlay with explicit uncertainty messaging, not as a precise prediction. The optimal sell window uses the known ENTSO-E day-ahead prices (published the night before, so certain) combined with the ML generation estimate.

Both models are exported as JSON and run via a hand-written tree traversal inference engine in TypeScript — no ML library in the browser.

---

## Data sources

| Source | What it provides | Status |
|--------|-----------------|--------|
| [Open-Meteo](https://open-meteo.com) | Real-time solar radiation, cloud cover, temperature | ✅ Live |
| [ENTSO-E](https://transparency.entsoe.eu) | Day-ahead spot prices (PLN/MWh) | ✅ Live (local only) |
| [PSE OpenData](https://www.pse.pl/dane-systemowe) | National grid load and balance | ⚠️ Known issue [#2](../../issues/2) |

---

## Running locally

```bash
git clone https://github.com/horno1337/solar-grid.git
cd solar-grid/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Click any voivodeship for the full breakdown.

You'll need a free ENTSO-E token for live prices — register at [transparency.entsoe.eu](https://transparency.entsoe.eu), then:

```bash
echo "VITE_ENTSO_TOKEN=your-token-here" > .env
```

Without it the app falls back to simulated prices automatically.

**To retrain the models:**

```bash
cd solar-grid/ml
uv sync
uv run python scripts/fetch_historical.py
uv run python scripts/train_irradiance.py
uv run python scripts/train_price.py
```

Requires Python 3.11+ and [uv](https://astral.sh/uv).

---

Open issues tracked in the [Issues tab](../../issues).

---

## Why this project?

Poland has installed over 20 GW of solar capacity as of 2024, one of the fastest-growing solar markets in Europe. The 2022 net-billing reform replaced the old fixed exchange ratio with market pricing — meaning the optimal decision now changes hourly and depends on conditions most prosumers can't easily track. This tool attempts to make that complexity navigable.

---

MIT — see [LICENSE](LICENSE)
