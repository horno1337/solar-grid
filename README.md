# SolarGrid 🌤️

> Real-time solar energy decision map for Polish prosumers — should you sell your energy to the grid, or consume it yourself?

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?style=flat-square&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=flat-square)

---

## What is this?

Since 2022, Polish solar panel owners (called **prosumers**) operate under a net-billing system — they can either consume the electricity their panels generate, or sell it back to the grid at the current spot price. The right choice changes throughout the day depending on weather conditions, grid load, and market prices.
So I made a basic interactive map that answers that question in real time, for every region in Poland simultaneously. It fetches live atmospheric data from Open-Meteo, models solar generation based on real cloud cover and temperature, compares the revenue from selling against the savings from self-consuming, and colors each region accordingly.

---

## How it works

The core of the project is a decision engine that runs this calculation for each region and each hour:

```
generation (kWh) = capacity × irradiance × panel_efficiency × temperature_correction

sell_revenue  = generation × spot_price (PLN/MWh) ÷ 1000 − congestion_penalty
consume_value = generation × prosumer_tariff (PLN/kWh)

score = sell_revenue − consume_value
```

A positive score means selling pays more. A negative score means self-consumption saves more. A score within ±0.05 PLN is too thin to act on confidently and is shown as neutral.

The **congestion penalty** is a key detail — when solar generation covers more than 15% of national grid load (common on sunny summer days), wholesale prices drop non-linearly due to the merit-order effect. The engine discounts the effective sell price accordingly, which is why the map can recommend self-consumption even when spot prices look reasonable.

The **temperature correction** accounts for the fact that solar panels lose approximately 0.4% of output per degree Celsius above 25°C — a real and measurable effect that most simple calculators ignore.

---

## Data sources

| Source | What it provides | Status |
|--------|-----------------|--------|
| [Open-Meteo](https://open-meteo.com) | Real-time solar radiation, cloud cover, temperature per region | ✅ Live |
| [PSE OpenData](https://www.pse.pl/dane-systemowe) | National grid load and balance | 🔜 Phase 2 |
| [TGE RDN](https://tge.pl) | Day-ahead spot prices (PLN/MWh) | 🔜 Phase 2 |

Currently, market data (prices and grid load) is simulated using realistic 24-hour patterns based on historical Polish market behaviour. The weather data is live from Open-Meteo.

---

## Running locally

```bash
# Clone the repo
git clone https://github.com/horno1337/solar-grid.git
cd solar-grid/frontend

# Install dependencies (only needed once)
npm install

# Start the development server
npm run dev
```

Then open `http://localhost:5173` in your browser. Click any voivodeship on the map to see a full breakdown of the sell-vs-consume decision for that region, including the live weather conditions and the mathematical derivation.

To verify TypeScript compiles cleanly:

```bash
npm run typecheck
```

---

Open issues are tracked in the [Issues tab](../../issues).

---

## Why this project?

Poland has installed over 20 GW of solar capacity as of 2024, making it one of the fastest-growing solar markets in Europe. The 2022 net-billing reform changed the economics significantly for the ~1.3 million prosumers already connected to the grid — the old 1:0.8 exchange ratio was replaced by a market-price system, meaning the optimal strategy now depends on real-time conditions rather than a fixed rule. This tool attempts to make that complexity navigable for anyone with panels on their roof.

---

## License

MIT — see [LICENSE](LICENSE) for details.
