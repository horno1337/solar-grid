/**
 * priceModel.ts
 *
 * Loads the exported LightGBM price forecasting model and runs inference
 * in the browser. Used to show historical price patterns alongside
 * the known ENTSO-E day-ahead prices.
 *
 * Important: this model has MAE ~148 PLN/MWh on a market averaging
 * 451 PLN/MWh. It captures structural patterns (morning/evening peaks,
 * weekday/weekend differences, seasonal variation) but cannot predict
 * short-term volatility. It is displayed with explicit uncertainty
 * messaging — never as a precise forecast.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
interface TreeNode {
  split_feature: number;
  threshold:     number;
  left_child:    TreeNode | LeafNode;
  right_child:   TreeNode | LeafNode;
}

interface LeafNode {
  leaf_value: number;
}

interface HorizonModel {
  num_trees: number;
  tree_info: { tree_structure: TreeNode | LeafNode }[];
}

interface PriceModel {
  features: string[];
  horizons: number[];
  models: Record<string, HorizonModel>;
  meta: {
    results: Record<number, { mae: number; r2: number }>;
  };
}

// ── Model loading ─────────────────────────────────────────────────────────────
let cachedModel: PriceModel | null = null;

async function loadModel(): Promise<PriceModel> {
  if (cachedModel) return cachedModel;

  const response = await fetch('/src/models/prices.json');
  if (!response.ok) throw new Error(`Failed to load price model: ${response.status}`);

  cachedModel = await response.json() as PriceModel;
  console.log('Price model loaded:', cachedModel.meta.results);
  return cachedModel;
}

// ── Tree traversal ────────────────────────────────────────────────────────────
function isLeaf(node: TreeNode | LeafNode): node is LeafNode {
  return 'leaf_value' in node;
}

function traverseTree(node: TreeNode | LeafNode, features: number[]): number {
  if (isLeaf(node)) return node.leaf_value;
  const val = features[node.split_feature];
  return val <= node.threshold
    ? traverseTree(node.left_child, features)
    : traverseTree(node.right_child, features);
}

// ── Feature vector ────────────────────────────────────────────────────────────
// Must match EXACTLY what train_price.py computed.
function buildFeatures(
  hour: number,
  recentPrices: number[], // last 48 hours of prices, most recent last
): number[] {
  const now       = new Date();
  const month     = now.getMonth() + 1;
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Mon
  const isWeekend = dayOfWeek >= 5 ? 1 : 0;

  const lag1  = recentPrices[recentPrices.length - 1]  ?? 400;
  const lag2  = recentPrices[recentPrices.length - 2]  ?? 400;
  const lag3  = recentPrices[recentPrices.length - 3]  ?? 400;
  const lag24 = recentPrices[recentPrices.length - 24] ?? 400;
  const lag48 = recentPrices[recentPrices.length - 48] ?? 400;

  const last6  = recentPrices.slice(-6);
  const last24 = recentPrices.slice(-24);
  const rollMean6  = last6.reduce((a, b)  => a + b, 0) / last6.length;
  const rollStd6   = Math.sqrt(last6.reduce((a, b)  => a + (b - rollMean6) ** 2, 0) / last6.length);
  const rollMean24 = last24.reduce((a, b) => a + b, 0) / last24.length;

  return [
    lag1, lag2, lag3, lag24, lag48,
    rollMean6, rollStd6, rollMean24,
    Math.sin(2 * Math.PI * hour      / 24),
    Math.cos(2 * Math.PI * hour      / 24),
    Math.sin(2 * Math.PI * dayOfWeek / 7),
    Math.cos(2 * Math.PI * dayOfWeek / 7),
    Math.sin(2 * Math.PI * month     / 12),
    Math.cos(2 * Math.PI * month     / 12),
    isWeekend,
  ];
}

// ── Inference ─────────────────────────────────────────────────────────────────
function runInference(model: HorizonModel, features: number[]): number {
  let prediction = 0;
  for (const tree of model.tree_info) {
    prediction += traverseTree(tree.tree_structure, features);
  }
  return prediction;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PriceForecast {
  /** Predicted price for this hour (PLN/MWh) */
  predicted:   number;
  /** ±1 MAE confidence band */
  uncertainty: number;
  horizon:     number;
}

/**
 * Returns typical price pattern predictions for hours 0–23.
 * Uses the 1h model for the current hour, 3h for near future,
 * 6h for further ahead. Displayed as a pattern overlay, not a
 * precise forecast — always shown with uncertainty band.
 */
export async function getPricePattern(
  currentHour: number,
  recentPrices: number[],
): Promise<PriceForecast[]> {
  const model = await loadModel();

  return Array.from({ length: 24 }, (_, hour) => {
    const hoursAhead = ((hour - currentHour) + 24) % 24 || 24;

    // Pick the closest available horizon model
    const horizon = hoursAhead <= 1 ? 1 : hoursAhead <= 3 ? 3 : 6;
    const key     = `horizon_${horizon}h`;
    const m       = model.models[key];

    const features  = buildFeatures(hour, recentPrices);
    const predicted = runInference(m, features);

    // MAE from training — shown as the uncertainty band
    const mae = model.meta.results[horizon]?.mae ?? 150;

    return { predicted, uncertainty: mae, horizon };
  });
}

/** Model accuracy summary for display in the UI */
export function getPriceModelMeta(): Record<number, { mae: number; r2: number }> {
  if (!cachedModel) return {};
  return cachedModel.meta.results;
}
