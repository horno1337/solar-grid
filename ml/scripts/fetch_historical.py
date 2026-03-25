"""
fetch_historical.py

Downloads 12 months of historical data needed to train the forecasting models:
  1. Hourly weather data for all 16 Polish voivodeships (Open-Meteo)
  2. Hourly day-ahead electricity prices for Poland (ENTSO-E)

Output:
  data/raw/weather_<REGION_ID>.csv   — one file per voivodeship
  data/raw/prices_pl.csv             — single file for all prices

Run with:
  uv run python scripts/fetch_historical.py
"""

import time
import httpx
import pandas as pd
from pathlib import Path
from datetime import date, timedelta
from dotenv import load_dotenv
import os
import xml.etree.ElementTree as ET

# ── Setup ─────────────────────────────────────────────────────────────────────
load_dotenv()

ENTSO_TOKEN = os.getenv("VITE_ENTSO_TOKEN")
RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

# Date range — last 12 months
END_DATE = date.today()
START_DATE = END_DATE - timedelta(days=365)

print(f"Fetching data from {START_DATE} to {END_DATE}")
print(f"Output directory: {RAW_DIR}")

# ── Region definitions ─────────────────────────────────────────────────────────
REGIONS = {
    "ZP": (53.5, 15.0),
    "PM": (54.2, 18.6),
    "WM": (53.8, 20.8),
    "PD": (53.1, 22.8),
    "LB": (51.9, 15.5),
    "WP": (52.4, 17.0),
    "KP": (53.0, 18.0),
    "MZ": (52.2, 21.0),
    "LD": (51.8, 19.5),
    "DS": (51.0, 16.5),
    "OP": (50.7, 17.9),
    "SL": (50.3, 19.0),
    "SK": (50.9, 20.6),
    "MA": (49.9, 20.5),
    "PK": (50.0, 22.5),
    "LU": (51.2, 23.0),
}

# ── 1. Weather data from Open-Meteo ───────────────────────────────────────────
# Open-Meteo's /archive endpoint provides historical reanalysis data.
# This is the same source as the forecast API but looking backwards —
# so the data format is identical, making it easy to align with our
# existing WeatherSnapshot structure on the TypeScript side.

WEATHER_FIELDS = [
    "direct_radiation",
    "diffuse_radiation",
    "cloud_cover",
    "temperature_2m",
    "precipitation",
]


def fetch_weather_for_region(region_id: str, lat: float, lon: float) -> pd.DataFrame:
    """Fetch 12 months of hourly weather data for one region."""

    print(f"  Fetching weather for {region_id} ({lat}, {lon})...")

    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": START_DATE.isoformat(),
        "end_date": END_DATE.isoformat(),
        "hourly": ",".join(WEATHER_FIELDS),
        "timezone": "Europe/Warsaw",
    }

    response = httpx.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    # Build a DataFrame with one row per hour
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(data["hourly"]["time"]),
            "direct_radiation": data["hourly"]["direct_radiation"],
            "diffuse_radiation": data["hourly"]["diffuse_radiation"],
            "cloud_cover": data["hourly"]["cloud_cover"],
            "temperature_2m": data["hourly"]["temperature_2m"],
            "precipitation": data["hourly"]["precipitation"],
        }
    )

    df["region_id"] = region_id
    df["hour"] = df["timestamp"].dt.hour
    df["month"] = df["timestamp"].dt.month
    df["day_of_year"] = df["timestamp"].dt.dayofyear

    return df


print("\n── Fetching weather data ──────────────────────────────────────────")
for region_id, (lat, lon) in REGIONS.items():
    output_path = RAW_DIR / f"weather_{region_id}.csv"

    # Skip if already downloaded — useful if the script gets interrupted
    if output_path.exists():
        print(f"  Skipping {region_id} — already exists")
        continue

    df = fetch_weather_for_region(region_id, lat, lon)
    df.to_csv(output_path, index=False)
    print(f"  Saved {len(df)} rows to {output_path.name}")

    # Be polite to the API — short pause between requests
    time.sleep(0.5)

# ── 2. Price data from ENTSO-E ────────────────────────────────────────────────
# ENTSO-E returns XML for historical data just like for forecasts.
# We parse the same structure but request a much wider date range.
# Note: ENTSO-E limits requests to 1 year of data per call,
# so we fetch month by month to stay within limits and be resilient
# to partial failures.

POLAND_DOMAIN = "10YPL-AREA-----S"
ENTSO_BASE = "https://web-api.tp.entsoe.eu/api"


def format_entso_date(d: date) -> str:
    return d.strftime("%Y%m%d%H%M")


def parse_entso_xml(xml_text: str) -> list[dict]:
    """Parse ENTSO-E XML response into a list of {timestamp, price_pln} dicts."""

    root = ET.fromstring(xml_text)
    ns = {"ns": "urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3"}
    rows = []

    for timeseries in root.findall(".//ns:TimeSeries", ns):
        for period in timeseries.findall(".//ns:Period", ns):
            # The period start tells us the base timestamp
            start_str = period.find("ns:timeInterval/ns:start", ns)
            if start_str is None:
                continue

            period_start = pd.to_datetime(start_str.text)

            for point in period.findall("ns:Point", ns):
                position = int(point.find("ns:position", ns).text)
                price = float(point.find("ns:price.amount", ns).text)

                # Position 1 = first hour of the period
                timestamp = period_start + pd.Timedelta(hours=position - 1)

                rows.append(
                    {
                        "timestamp": timestamp,
                        "price_eur_mwh": price,
                        "price_pln_mwh": price * 4.25,  # approximate EUR→PLN
                    }
                )

    return rows


def fetch_prices_for_month(year: int, month: int) -> list[dict]:
    """Fetch day-ahead prices for one calendar month."""

    if not ENTSO_TOKEN:
        raise ValueError("VITE_ENTSO_TOKEN not found in .env file")

    # Calculate start and end of the month
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    print(f"  Fetching prices for {year}-{month:02d}...")

    params = {
        "securityToken": ENTSO_TOKEN,
        "documentType": "A44",
        "in_Domain": POLAND_DOMAIN,
        "out_Domain": POLAND_DOMAIN,
        "periodStart": format_entso_date(start),
        "periodEnd": format_entso_date(end),
    }

    response = httpx.get(ENTSO_BASE, params=params, timeout=30)
    response.raise_for_status()

    return parse_entso_xml(response.text)


print("\n── Fetching price data ────────────────────────────────────────────")

prices_path = RAW_DIR / "prices_pl.csv"

if prices_path.exists():
    print("  prices_pl.csv already exists — skipping")
else:
    all_prices = []

    # Iterate month by month over the past 12 months
    current = START_DATE.replace(day=1)
    while current <= END_DATE:
        try:
            rows = fetch_prices_for_month(current.year, current.month)
            all_prices.extend(rows)
            print(
                f"  Got {len(rows)} hourly prices for {current.year}-{current.month:02d}"
            )
        except Exception as e:
            print(f"  Failed for {current.year}-{current.month:02d}: {e}")

        # Move to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)

        time.sleep(1)  # respect rate limits

    if all_prices:
        df_prices = pd.DataFrame(all_prices)
        df_prices = df_prices.sort_values("timestamp").drop_duplicates("timestamp")
        df_prices["hour"] = pd.to_datetime(df_prices["timestamp"]).dt.hour
        df_prices["month"] = pd.to_datetime(df_prices["timestamp"]).dt.month
        df_prices["day_of_week"] = pd.to_datetime(df_prices["timestamp"]).dt.dayofweek
        df_prices.to_csv(prices_path, index=False)
        print(f"\n  Saved {len(df_prices)} hourly prices to {prices_path.name}")

print("\n── Done ───────────────────────────────────────────────────────────")
print("Next step: run notebooks/01_explore_weather.ipynb to inspect the data")
