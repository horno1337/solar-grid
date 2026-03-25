/**
 * irradianceModel.ts
 *
 * Loads the exported LightGBM model and runs inference entirely in the browser.
 * No Python, no server, no ML library needed — just the JSON weights and this file.
 *
 * How LightGBM inference works:
 * The model is a collection of decision trees. Each tree looks at the input
 * features and follows a path from root to leaf based on split conditions
 * like "if direct_radiation > 450, go right, else go left". The leaf node
 * holds a number. We sum up the leaf values from all 496 trees to get the
 * final prediction. That's it.
 */

import type { WeatherSnapshot } from '../types/index.js';

// ── Model types ───────────────────────────────────────────────────────────────
// These mirror the structure of the exported JSON file.
// A tree is a recursive structure where each node either splits
// (has left/right children) or is a leaf (has a final value).

interface TreeNode {
  split_feature:    number;   // index into the features array
  threshold:        number;   // the value to compare against
  left_child:       TreeNode | LeafNode;
  right_child:      TreeNode | LeafNode;
}

interface LeafNode {
  leaf_value: number;         // the prediction contribution from this leaf
}

interface TreeInfo {
  tree_index:     number;
  num_leaves:     number;
  shrinkage:      number;
  tree_structure: TreeNode | LeafNode;
}

interface IrradianceModel {
  features:  string[];
  num_trees: number;
  tree_info: TreeInfo[];
  meta: {
    mae: number;
    r2:  number;
  };
}

// ── Model loading ─────────────────────────────────────────────────────────────
// We load the model once and cache it — no need to reload on every prediction.
// The model JSON is a static asset served by Vite, so it loads fast.
let cachedModel: IrradianceModel | null = null;

async function loadModel(): Promise<IrradianceModel> {
  if (cachedModel) return cachedModel;

  const response = await fetch('/src/models/irradiance.json');
  if (!response.ok) {
    throw new Error(`Failed to load irradiance model: ${response.status}`);
  }

  cachedModel = await response.json() as IrradianceModel;
  console.log(
    `Irradiance model loaded: ${cachedModel.num_trees} trees, ` +
    `MAE=${cachedModel.meta.mae}, R²=${cachedModel.meta.r2}`
  );

  return cachedModel;
}

// ── Tree traversal ────────────────────────────────────────────────────────────
// Walk a single decision tree from root to leaf, following split conditions.
// At each internal node: if feature[split_feature] <= threshold, go left.
// Otherwise go right. When we reach a leaf, return its value.

function isLeaf(node: TreeNode | LeafNode): node is LeafNode {
  return 'leaf_value' in node;
}

function traverseTree(node: TreeNode | LeafNode, features: number[]): number {
  if (isLeaf(node)) {
    return node.leaf_value;
  }

  const featureValue = features[node.split_feature];

  if (featureValue <= node.threshold) {
    return traverseTree(node.left_child, features);
  } else {
    return traverseTree(node.right_child, features);
  }
}

// ── Feature engineering ───────────────────────────────────────────────────────
// Must match EXACTLY what the Python training script computed.
// If the order or formula differs, predictions will be wrong.

function buildFeatureVector(weather: WeatherSnapshot, latitude: number): number[] {
  const hour  = weather.hour;
  const month = new Date().getMonth() + 1; // 1–12

  return [
    weather.directRadiationWm2,                          // direct_radiation
    weather.diffuseRadiationWm2,                         // diffuse_radiation
    weather.cloudCoverPct,                               // cloud_cover
    weather.temperature2mC,                              // temperature_2m
    weather.precipitationMm,                             // precipitation
    Math.sin(2 * Math.PI * hour  / 24),                  // hour_sin
    Math.cos(2 * Math.PI * hour  / 24),                  // hour_cos
    Math.sin(2 * Math.PI * month / 12),                  // month_sin
    Math.cos(2 * Math.PI * month / 12),                  // month_cos
    latitude,                                            // latitude
  ];
}

// ── Main prediction function ──────────────────────────────────────────────────
// This is what the decision engine calls instead of effectiveIrradianceFromWeather().
// It returns the model's prediction in kWh/m² for one hour.

export async function predictIrradiance(
  weather: WeatherSnapshot,
  latitude: number,
): Promise<number> {
  const model    = await loadModel();
  const features = buildFeatureVector(weather, latitude);

  // Sum up leaf values from all trees
  // This is the complete LightGBM inference algorithm
  let prediction = 0;
  for (const tree of model.tree_info) {
    prediction += traverseTree(tree.tree_structure, features);
  }

  // Clamp to zero — can't have negative irradiance
  return Math.max(0, prediction);
}

// ── Synchronous fallback ──────────────────────────────────────────────────────
// The decision engine is synchronous (it runs on every render tick).
// We keep a cache of the last model predictions so the engine can use
// ML predictions without needing to await on every call.
// The cache gets refreshed whenever new weather data arrives.

const predictionCache = new Map<string, number>();

export function getCachedIrradiance(regionId: string, hour: number): number | undefined {
  return predictionCache.get(`${regionId}:${hour}`);
}

export async function warmPredictionCache(
  regionId: string,
  latitude: number,
  hourlyWeather: WeatherSnapshot[],
): Promise<void> {
  for (const weather of hourlyWeather) {
    const prediction = await predictIrradiance(weather, latitude);
    predictionCache.set(`${regionId}:${weather.hour}`, prediction);
  }
}
