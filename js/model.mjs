// 数值与展示逻辑独立于 DOM / Keep data semantics separate from the DOM.
export const YEARS = [2007, 2008, 2009, 2010, 2011];
export const PUMAS = Array.from({ length: 10 }, (_, i) => `038${String(i + 1).padStart(2, "0")}`);
export const isNumber = value => typeof value === "number" && Number.isFinite(value);

export function rentGrowth(row) {
  if (row.rent_growth_status === "exact" && isNumber(row.rent_growth_nominal_pct)) {
    return { value: row.rent_growth_nominal_pct, kind: "exact" };
  }
  // 只绘制有明确定义的下限 / Plot a lower bound only when explicitly identified.
  if (row.rent_growth_status === "lower_bound" && isNumber(row.rent_growth_nominal_pct_lower_bound)) {
    return { value: row.rent_growth_nominal_pct_lower_bound, kind: "lower_bound" };
  }
  return { value: null, kind: "unavailable" };
}

export function createDomains(comparisons) {
  const baseRents = comparisons.map(r => r.median_gross_rent_base).filter(isNumber);
  // 全期共用固定坐标范围；地图和气泡范围仍由全期数据计算 / Fixed scatter domains across all endpoints.
  return {
    y: [-10, 50],
    xGrowth: [-10, 15],
    xBurden: [35, 60],
    mapRent: [Math.floor(Math.min(...baseRents) / 250) * 250, Math.ceil(Math.max(...baseRents) / 250) * 250],
    maxHousing: Math.max(...comparisons.map(r => r.housing_units_end).filter(isNumber)),
  };
}

export function rankBurdenChanges(rows) {
  const changes = rows
    .filter(row => isNumber(row.rent_burden_pct_base) && isNumber(row.rent_burden_pct_end))
    .map(row => ({ puma: row.puma, change: row.rent_burden_pct_end - row.rent_burden_pct_base }))
    .sort((a, b) => b.change - a.change);
  const ranks = new Map();
  let rank = 0;
  changes.forEach((entry, index) => {
    // 全部 PUMA 按百分点变化降序排列；相同变化并列 / Equal changes share a competition rank.
    if (index === 0 || entry.change !== changes[index - 1].change) rank = index + 1;
    ranks.set(entry.puma, { change: entry.change, rank, total: changes.length });
  });
  return ranks;
}

export function buildModel(annual, comparisons, geography) {
  const annualByKey = new Map(annual.map(r => [`${r.year}:${r.puma}`, r]));
  const comparisonsByYear = new Map(YEARS.map(year => [year, comparisons.filter(r => r.end_year === year)]));
  if (annual.length !== 60 || annualByKey.size !== 60 || comparisons.length !== 50) throw new Error("Expected 60 annual records and 50 comparison records.");
  const mapPumas = new Set(geography.features.map(f => f.properties.PUMA));
  if (mapPumas.size !== 10 || geography.features.length !== 10) throw new Error("Expected ten Manhattan map features.");
  for (const year of YEARS) {
    const rows = comparisonsByYear.get(year);
    if (rows.length !== 10 || new Set(rows.map(r => r.puma)).size !== 10) throw new Error(`Incomplete endpoint: ${year}`);
    for (const row of rows) {
      if (row.base_year !== 2006 || !PUMAS.includes(row.puma) || !mapPumas.has(row.puma)
        || !annualByKey.has(`2006:${row.puma}`) || !annualByKey.has(`${year}:${row.puma}`)) throw new Error("Invalid baseline or PUMA join.");
    }
  }
  const burdenRanksByYear = new Map(YEARS.map(year => [year, rankBurdenChanges(comparisonsByYear.get(year))]));
  return { annualByKey, comparisonsByYear, burdenRanksByYear, geography, domains: createDomains(comparisons) };
}

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const formatInteger = value => isNumber(value) ? integerFormat.format(value) : "Not available";
export function formatPercent(value, signed = false) {
  if (!isNumber(value)) return "Not available";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
export function formatPercentagePoints(value) {
  if (!isNumber(value)) return "Not available";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
}
export function formatRent(annual) {
  if (annual.median_gross_rent_status === "top_coded_ge_2000" && isNumber(annual.median_gross_rent_lower_bound)) {
    return `at least $${formatInteger(annual.median_gross_rent_lower_bound)}`;
  }
  if (isNumber(annual.median_gross_rent)) return `$${formatInteger(annual.median_gross_rent)}`;
  return "Not available";
}
export function formatRentGrowth(row) {
  const growth = rentGrowth(row);
  return `${growth.kind === "lower_bound" ? "at least " : ""}${formatPercent(growth.value, true)}`;
}
export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
