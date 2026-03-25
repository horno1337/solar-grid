import json
import numpy as np
import pandas as pd
import lightgbm as lgb
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

# ── Paths ─────────────────────────────────────────────────────────────────────
RAW_DIR = Path("data/raw")
MODELS_DIR = Path("../frontend/src/models")
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Load and combine all regional weather data ────────────────────────────────
print("Loading weather data...")
dfs = []
for csv_file in sorted(RAW_DIR.glob("weather_*.csv")):
    df = pd.read_csv(csv_file, parse_dates=["timestamp"])
    dfs.append(df)

weather = pd.concat(dfs, ignore_index=True)
print(f"Loaded {len(weather):,} rows across {weather['region_id'].nunique()} regions")

# ── Feature engineering ───────────────────────────────────────────────────────
print("Engineering features...")

# Target variable — effective irradiance with temperature correction
TEMP_COEFF = 0.004
STC_TEMP = 25
weather["temp_correction"] = 1 - TEMP_COEFF * (
    weather["temperature_2m"] - STC_TEMP
).clip(lower=0)
weather["effective_irradiance"] = (
    (weather["direct_radiation"] + weather["diffuse_radiation"]) / 1000
) * weather["temp_correction"]

# Cyclical encoding for hour and month
# encodes time as a position on a circle so the model understands
# that hour 23 and hour 0 are adjacent, and December and January are adjacent
weather["hour_sin"] = np.sin(2 * np.pi * weather["hour"] / 24)
weather["hour_cos"] = np.cos(2 * np.pi * weather["hour"] / 24)
weather["month_sin"] = np.sin(2 * np.pi * weather["month"] / 12)
weather["month_cos"] = np.cos(2 * np.pi * weather["month"] / 12)

# Latitude as a feature — southern regions get more sun
# Map region_id to latitude using the same values as regions.ts
REGION_LATS = {
    "ZP": 53.5,
    "PM": 54.2,
    "WM": 53.8,
    "PD": 53.1,
    "LB": 51.9,
    "WP": 52.4,
    "KP": 53.0,
    "MZ": 52.2,
    "LD": 51.8,
    "DS": 51.0,
    "OP": 50.7,
    "SL": 50.3,
    "SK": 50.9,
    "MA": 49.9,
    "PK": 50.0,
    "LU": 51.2,
}
weather["latitude"] = weather["region_id"].map(REGION_LATS)

# Drop nighttime rows — irradiance is always zero at night
daytime = weather["effective_irradiance"] > 0.001
print(f"Daytime rows: {daytime.sum():,} / {len(weather):,} ({daytime.mean()*100:.1f}%)")
weather_day = weather[daytime].copy()

# ── Define features and target ────────────────────────────────────────────────
FEATURES = [
    "direct_radiation",
    "diffuse_radiation",
    "cloud_cover",
    "temperature_2m",
    "precipitation",
    "hour_sin",
    "hour_cos",
    "month_sin",
    "month_cos",
    "latitude",
]

TARGET = "effective_irradiance"

X = weather_day[FEATURES]
y = weather_day[TARGET]

# ── Train / test split ────────────────────────────────────────────────────────
# Use the last 2 months as the test set — this simulates predicting
# future data, which is the real use case
cutoff = weather_day["timestamp"].quantile(0.83)
train_mask = weather_day["timestamp"] <= cutoff
test_mask = weather_day["timestamp"] > cutoff

X_train, y_train = X[train_mask], y[train_mask]
X_test, y_test = X[test_mask], y[test_mask]

print(f"\nTrain: {len(X_train):,} rows")
print(f"Test:  {len(X_test):,} rows")

# ── Train LightGBM ────────────────────────────────────────────────────────────
print("\nTraining LightGBM model...")

model = lgb.LGBMRegressor(
    n_estimators=500,
    learning_rate=0.05,
    max_depth=6,
    num_leaves=31,
    min_child_samples=20,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    verbose=-1,
)

model.fit(
    X_train,
    y_train,
    eval_set=[(X_test, y_test)],
    callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
)

# ── Evaluate ──────────────────────────────────────────────────────────────────
print("\nEvaluating...")
y_pred = model.predict(X_test)
mae = mean_absolute_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print(f"MAE: {mae:.4f} kWh/m²")
print(f"R²:  {r2:.4f}")
print(f"\nFor context: mean irradiance in test set = {y_test.mean():.4f} kWh/m²")
print(f"Relative MAE: {mae / y_test.mean() * 100:.1f}%")

# ── Feature importance ────────────────────────────────────────────────────────
importance = pd.Series(model.feature_importances_, index=FEATURES).sort_values(
    ascending=False
)

print("\nFeature importance:")
for feat, imp in importance.items():
    bar = "█" * int(imp / importance.max() * 30)
    print(f"  {feat:<22} {bar} {imp:.0f}")

# ── Export model as JSON ──────────────────────────────────────────────────────

print("\nExporting model...")

model_dict = model.booster_.dump_model()

export = {
    "features": FEATURES,
    "num_trees": model_dict["num_trees"],
    "num_class": 1,
    "average_output": False,
    "tree_info": model_dict["tree_info"],
    "meta": {
        "mae": round(mae, 4),
        "r2": round(r2, 4),
        "trained_on_rows": len(X_train),
        "target": TARGET,
        "description": "Predicts effective solar irradiance (kWh/m²) from weather features",
    },
}

output_path = MODELS_DIR / "irradiance.json"
with open(output_path, "w") as f:
    json.dump(export, f, separators=(",", ":"))

file_size_kb = output_path.stat().st_size / 1024
print(f"Saved to {output_path}")
print(f"File size: {file_size_kb:.1f} KB")
print("\nDone. Next step: implement irradianceModel.ts in the frontend.")
