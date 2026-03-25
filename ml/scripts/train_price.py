import json
import numpy as np
import pandas as pd
import lightgbm as lgb
from pathlib import Path
from sklearn.metrics import mean_absolute_error, r2_score

# ── Paths ─────────────────────────────────────────────────────────────────────
RAW_DIR = Path("data/raw")
MODELS_DIR = Path("../frontend/src/models")
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Load price data ───────────────────────────────────────────────────────────
print("Loading price data...")
df = pd.read_csv(RAW_DIR / "prices_pl.csv", parse_dates=["timestamp"])
df["timestamp"] = df["timestamp"].dt.tz_convert("Europe/Warsaw")
df = df.sort_values("timestamp").reset_index(drop=True)

print(f"Loaded {len(df):,} hourly prices")
print(f"Range: {df['timestamp'].min()} → {df['timestamp'].max()}")
print(
    f"Price range: {df['price_pln_mwh'].min():.0f} → {df['price_pln_mwh'].max():.0f} PLN/MWh"
)

# ── Feature engineering ───────────────────────────────────────────────────────
print("\nEngineering features...")

# Time features with cyclical encoding
df["hour"] = df["timestamp"].dt.hour
df["month"] = df["timestamp"].dt.month
df["day_of_week"] = df["timestamp"].dt.dayofweek

df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
df["dow_sin"] = np.sin(2 * np.pi * df["day_of_week"] / 7)
df["dow_cos"] = np.cos(2 * np.pi * df["day_of_week"] / 7)
df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)

# Weekend flag — prices are structurally lower on weekends
df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

# Lag features — past prices as predictors
# Based on autocorrelation analysis: strong at 1h, 2h, 3h, 24h, 48h
for lag in [1, 2, 3, 24, 48]:
    df[f"price_lag_{lag}h"] = df["price_pln_mwh"].shift(lag)

# Rolling statistics — capture recent price trend and volatility
df["price_roll_mean_6h"] = df["price_pln_mwh"].shift(1).rolling(6).mean()
df["price_roll_std_6h"] = df["price_pln_mwh"].shift(1).rolling(6).std()
df["price_roll_mean_24h"] = df["price_pln_mwh"].shift(1).rolling(24).mean()

# Drop rows with NaN from lag creation (first 48 rows)
df = df.dropna().reset_index(drop=True)
print(f"Rows after dropping NaN: {len(df):,}")

# ── Define features ───────────────────────────────────────────────────────────
FEATURES = [
    "price_lag_1h",
    "price_lag_2h",
    "price_lag_3h",
    "price_lag_24h",
    "price_lag_48h",
    "price_roll_mean_6h",
    "price_roll_std_6h",
    "price_roll_mean_24h",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "month_sin",
    "month_cos",
    "is_weekend",
]

# ── Train one model per forecast horizon ──────────────────────────────────────
# We train separate models for 1h, 3h, and 6h ahead predictions.
# Each model has the same features but a different target (price N hours ahead).
# This is called a "direct multi-step forecast" strategy — simpler and often
# more accurate than trying to predict all horizons with one model.

HORIZONS = [1, 3, 6]
results = {}

# Chronological train/test split — last 2 months as test set
cutoff = df["timestamp"].quantile(0.83)
train_mask = df["timestamp"] <= cutoff
test_mask = df["timestamp"] > cutoff

print(f"\nTrain: {train_mask.sum():,} rows")
print(f"Test:  {test_mask.sum():,} rows")

all_tree_info = {}

for horizon in HORIZONS:
    print(f"\n── Training {horizon}h ahead model ─────────────────────────")

    # Target: price N hours in the future
    target = f"price_{horizon}h_ahead"
    df[target] = df["price_pln_mwh"].shift(-horizon)

    # Drop rows where target is NaN (last N rows)
    valid = df[target].notna()
    X_train = df.loc[train_mask & valid, FEATURES]
    y_train = df.loc[train_mask & valid, target]
    X_test = df.loc[test_mask & valid, FEATURES]
    y_test = df.loc[test_mask & valid, target]

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
        callbacks=[
            lgb.early_stopping(50, verbose=False),
            lgb.log_evaluation(100),
        ],
    )

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    print(f"MAE: {mae:.1f} PLN/MWh")
    print(f"R²:  {r2:.4f}")
    print(f"Relative MAE: {mae / y_test.mean() * 100:.1f}%")

    # Feature importance
    importance = pd.Series(model.feature_importances_, index=FEATURES).sort_values(
        ascending=False
    )
    print("\nTop 5 features:")
    for feat, imp in importance.head(5).items():
        print(f"  {feat:<25} {imp:.0f}")

    results[horizon] = {"mae": round(mae, 1), "r2": round(r2, 4)}

    # Store tree info for export
    model_dict = model.booster_.dump_model()
    all_tree_info[f"horizon_{horizon}h"] = {
        "num_trees": len(model_dict["tree_info"]),
        "tree_info": model_dict["tree_info"],
    }

# ── Export ────────────────────────────────────────────────────────────────────
print("\n── Exporting model ──────────────────────────────────────────────")

export = {
    "features": FEATURES,
    "horizons": HORIZONS,
    "models": all_tree_info,
    "meta": {
        "description": "Predicts Polish day-ahead electricity prices (PLN/MWh) at 1h, 3h, 6h horizons",
        "results": results,
    },
}

output_path = MODELS_DIR / "prices.json"
with open(output_path, "w") as f:
    json.dump(export, f, separators=(",", ":"))

file_size_kb = output_path.stat().st_size / 1024
print(f"Saved to {output_path}")
print(f"File size: {file_size_kb:.1f} KB")

print("\n── Summary ──────────────────────────────────────────────────────")
for horizon, res in results.items():
    print(f"  {horizon}h ahead: MAE={res['mae']} PLN/MWh, R²={res['r2']}")
