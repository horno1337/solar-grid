# SolarGrid PL 🌤️

> Real-time solar energy decision map for Polish prosumers — should you sell your energy to the grid, or consume it yourself?

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python)
![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?style=flat-square&logo=vite)
![LightGBM](https://img.shields.io/badge/LightGBM-R²%200.9991-success?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=flat-square)

---

## What is this?

Since 2022, Polish solar panel owners operate under a net-billing system — either consume the electricity their panels generate, or sell it back to the grid at the current spot price. The right choice changes throughout the day depending on weather conditions, grid load, and market prices.

SolarGrid is an interactive map that answers that question in real time, for every voivodeship in Poland simultaneously. Fetches live atmospheric data from Open-Meteo, runs a machine learning model to estimate solar generation, compares the revenue from selling against the savings from self-consuming, and colors each region accordingly.

---

## How it works

The core of the project is a decision engine that runs this calculation for each region and each hour:

```
generation (kWh) = capacity × ML_irradiance(weather) × panel_efficiency

sell_revenue  = generation × spot_price (PLN/MWh) ÷ 1000 − congestion_penalty
consume_value = generation × prosumer_tariff (PLN/kWh)

score = sell_revenue − consume_value
```

A positive score means selling pays more. A negative score means self-consumption saves more. A score within ±0.05 PLN is too thin to act on confidently and is shown as neutral.

The **congestion penalty** accounts for the merit-order effect — when solar generation covers more than 15% of national grid load (common on sunny summer days), wholesale prices drop non-linearly. The engine discounts the effective sell price accordingly.

The **temperature correction** accounts for the fact that solar panels lose approximately 0.4% of output per degree Celsius above 25°C — a real and measurable effect that most calculators ignore.

---

## Machine learning model

for the estimation I used a **LightGBM gradient boosting model** trained on 12 months of historical atmospheric data for all 16 Polish voivodeships. The model runs entirely in the browser — no server or Python runtime needed at inference time.

### Training data
- **Source:** Open-Meteo historical archive API
- **Coverage:** March 2025 → March 2026, all 16 voivodeships
- **Rows:** 140,544 hourly observations (73,263 daytime rows used for training)

### Features
| Feature | Description |
|---------|-------------|
| `direct_radiation` | Direct beam solar radiation (W/m²) |
| `diffuse_radiation` | Scattered sky radiation (W/m²) |
| `cloud_cover` | Cloud cover percentage |
| `temperature_2m` | Air temperature at 2m height (°C) |
| `precipitation` | Precipitation in mm |
| `hour_sin / hour_cos` | Cyclical encoding of hour of day |
| `month_sin / month_cos` | Cyclical encoding of month |
| `latitude` | Geographic latitude of the region |

### Performance
| Metric | Value |
|--------|-------|
| MAE | 0.0036 kWh/m² |
| R² | 0.9991 |
| Relative error | 1.9% |
| Trees | 496 |

The model was evaluated on a chronological held-out test set (the final 2 months of data) to simulate real-world forward prediction. R² of 0.9991 means the model explains 99.91% of the variance in effective irradiance.

### How it runs in the browser

The trained model is exported as a JSON file (`frontend/src/models/irradiance.json`, ~5MB) containing the full tree structure. The TypeScript inference engine in `src/engine/irradianceModel.ts` traverses each of the 496 decision trees and sums their leaf values — the complete LightGBM prediction algorithm implemented in ~30 lines of TypeScript, with no external dependencies.

```
Python (offline):
  12 months weather data → LightGBM training → irradiance.json

Browser (live):
  Open-Meteo weather → irradianceModel.ts → generation estimate → decision engine → map
```

---

## Architecture

```
solar-grid/
├── frontend/        TypeScript + Vite
│   └── src/
│       ├── api/         Open-Meteo weather, ENTSO-E prices, PSE grid load
│       ├── data/        Region configs, simulated market data fallbacks
│       ├── engine/      Decision logic + LightGBM inference
│       ├── models/      Exported ML model weights (irradiance.json)
│       ├── map/         SVG Poland map rendering
│       ├── types/       TypeScript interfaces
│       └── ui/          Sidebar, controls, region detail card
│
└── ml/              Python + uv
    ├── data/raw/        Historical weather + price CSVs (gitignored)
    ├── notebooks/       Exploratory data analysis
    └── scripts/         Data fetching and model training
```

---

## Data sources

| Source | What it provides | Status |
|--------|-----------------|--------|
| [Open-Meteo](https://open-meteo.com) | Real-time solar radiation, cloud cover, temperature | ✅ Live |
| [ENTSO-E](https://transparency.entsoe.eu) | Day-ahead spot prices (PLN/MWh) | ✅ Live |
| [PSE OpenData](https://www.pse.pl/dane-systemowe) | National grid load and balance | ⚠️ Known issue (#2) |

---

## Running locally

### Frontend

```bash
git clone https://github.com/horno1337/solar-grid.git
cd solar-grid/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Click any voivodeship to see the full sell-vs-consume analysis with live weather data and ML-powered generation estimates.

You'll need an ENTSO-E API token for live price data. Register free at [transparency.entsoe.eu](https://transparency.entsoe.eu), then:

```bash
echo "VITE_ENTSO_TOKEN=your-token-here" > .env
```

Without the token the app falls back to simulated prices automatically.

### ML pipeline

```bash
cd solar-grid/ml
uv install          # install Python dependencies
uv run python scripts/fetch_historical.py   # download training data
uv run python scripts/train_irradiance.py   # train and export model
```

---

## Issues

Open issues are tracked in the [Issues tab](../../issues).

---

## Why this project?

Poland has installed over 20 GW of solar capacity as of 2024, making it one of the fastest-growing solar markets in Europe. The 2022 net-billing reform changed the economics significantly for the ~1.3 million prosumers already connected to the grid — the old 1:0.8 exchange ratio was replaced by a market-price system, meaning the optimal strategy now depends on real-time conditions rather than a fixed rule. This tool attempts to make that complexity navigable for anyone with panels on their roof.

---

## License

MIT — see [LICENSE](LICENSE) for details.
