import { isNumber, rentGrowth, formatPercent, formatInteger, formatRentGrowth } from "./model.mjs";

const d3 = globalThis.d3;
const CHART_HEIGHT = 520;
const REGION_SYMBOL_AREA = 180;
export const REGION_SHAPES = { Downtown: d3.symbolCircle, Midtown: d3.symbolSquare, Uptown: d3.symbolTriangle };

export function sphericalGeometry(geography) {
  // D3 球面多边形使用顺时针外环 / D3 spherical polygons need clockwise exterior rings.
  const polygon = rings => rings.map((ring, i) => (d3.polygonArea(ring) > 0) === (i === 0) ? ring : [...ring].reverse());
  return { ...geography, features: geography.features.map(feature => ({ ...feature, geometry: {
    ...feature.geometry,
    coordinates: feature.geometry.type === "Polygon" ? polygon(feature.geometry.coordinates) : feature.geometry.coordinates.map(polygon),
  } })) };
}

export function displayGeometry(geography) {
  const normalized = sphericalGeometry(geography);
  // 历史陆地显示文件已去水域和 10 号区离岛 / The land file already omits water and PUMA 10's detached islands.
  if (geography.display_land_only) return normalized;
  // 完整源边界的兼容显示 / Preserve the original full-boundary display fallback.
  return { ...normalized, features: normalized.features.map(feature => {
    if (feature.properties.PUMA !== "03810" || feature.geometry.type !== "MultiPolygon") return feature;
    const mainland = feature.geometry.coordinates.reduce((largest, part) =>
      Math.abs(d3.polygonArea(part[0])) > Math.abs(d3.polygonArea(largest[0])) ? part : largest);
    return { ...feature, geometry: { type: "Polygon", coordinates: mainland } };
  }) };
}

function bindInteractions(marks, view, hooks) {
  marks.attr("role", "button").attr("tabindex", 0)
    .attr("data-view", view).attr("data-puma", d => d.row.puma)
    .attr("aria-label", d => `PUMA ${d.row.puma}, ${d.row.end_year}. ${view === "map" ? `2006 median monthly gross rent $${formatInteger(d.row.median_gross_rent_base)}.` : `Housing growth ${formatPercent(d.row.housing_growth_pct)}.`} Rent growth ${formatRentGrowth(d.row)}. Select across all views.`)
    .on("pointerenter", function (event, d) { hooks.hover(event, d.row, view, this); })
    .on("pointermove", event => hooks.move(event))
    .on("pointerleave", () => hooks.leave())
    .on("focus", function (event, d) { hooks.hover(event, d.row, view, this); })
    .on("blur", () => hooks.leave())
    .on("click", (event, d) => hooks.select(d.row.puma, event.ctrlKey))
    .on("keydown", (event, d) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        hooks.select(d.row.puma, event.ctrlKey);
      }
    });
}

export class HousingMap {
  constructor(host, model, colorScale, hooks) {
    this.host = host;
    this.geometry = displayGeometry(model.geography);
    this.color = colorScale;
    this.hooks = hooks;
    this.svg = d3.select(host).append("svg").attr("role", "group").attr("aria-label", "2006 median monthly gross rent map. Ten selectable PUMA regions.");
    this.svg.append("rect").attr("class", "map-water").attr("rx", 3);
    this.layer = this.svg.append("g");
    this.north = this.svg.append("g").attr("aria-hidden", "true");
    this.north.append("path").attr("d", "M0,22V0m-4,6 4,-6 4,6").attr("fill", "none").attr("stroke", "#8ca0a2");
    this.north.append("text").attr("class", "map-north").attr("x", 0).attr("y", -7).attr("text-anchor", "middle").text("N");
  }

  render(rows) {
    const width = this.host.clientWidth;
    const height = matchMedia("(max-width: 950px)").matches ? 390 : CHART_HEIGHT;
    this.svg.attr("viewBox", `0 0 ${width} ${height}`).attr("data-year", rows[0].end_year);
    this.svg.select(".map-water").attr("width", width).attr("height", height - 8);
    const projection = d3.geoMercator().fitExtent([[20, 8], [width - 20, height - 15]], this.geometry);
    const path = d3.geoPath(projection);
    this.north.attr("transform", `translate(${width - 20},40)`);
    const byPuma = new Map(rows.map(row => [row.puma, row]));
    const entries = this.geometry.features.map(feature => ({ feature, row: byPuma.get(feature.properties.PUMA) }));
    const marks = this.layer.selectAll("g.map-puma").data(entries, d => d.row.puma).join(enter => {
      const mark = enter.append("g").attr("class", "data-mark map-puma");
      mark.append("path").attr("class", "mark-shape");
      mark.append("text").attr("class", "map-label").attr("text-anchor", "middle").attr("dy", ".35em");
      return mark;
    });
    marks.select("path").attr("d", d => path(d.feature))
      .style("fill", d => isNumber(d.row.median_gross_rent_base) ? this.color(d.row.median_gross_rent_base) : "#d8dedb")
      .attr("data-baseline-rent", d => d.row.median_gross_rent_base);
    const darkLabel = d => d3.lab(this.color(d.row.median_gross_rent_base)).l < 49;
    marks.select("text")
      .attr("transform", d => `translate(${projection([d.feature.properties.INTPTLON, d.feature.properties.INTPTLAT])})`)
      .attr("fill", d => darkLabel(d) ? "#fff" : "#24434d")
      .style("stroke", d => darkLabel(d) ? this.color(d.row.median_gross_rent_base) : "#fff").text(d => d.row.puma_short);
    bindInteractions(marks, "map", this.hooks);
  }
}

function intersects(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function labelPositions(points, width, height) {
  // 只移动标签，保持真实点位 / Reposition labels without moving data points.
  const occupied = [];
  const placements = new Map();
  for (const point of [...points].sort((a, b) => Number(b.bound) - Number(a.bound) || a.y - b.y)) {
    const w = point.bound ? 21 : 14;
    const gap = point.radius + 5;
    const candidates = [
      { x: point.x + gap, y: point.y - 5 },
      { x: point.x - gap - w, y: point.y - 5 },
      { x: point.x - w / 2, y: point.y + gap + 4 },
      { x: point.x - w / 2, y: point.y - gap - 12 },
      { x: point.x + gap, y: point.y + gap },
      { x: point.x - gap - w, y: point.y + gap },
    ].map(candidate => ({ x: Math.max(2, Math.min(width - w - 2, candidate.x)), y: Math.max(2, Math.min(height - 14, candidate.y)), w, h: 12 }));
    const score = rectangle => occupied.reduce((sum, other) => sum + intersects(rectangle, other) * 100, 0)
      + points.reduce((sum, other) => sum + intersects(rectangle, { x: other.x - other.radius - 2, y: other.y - other.radius - 2, w: 2 * other.radius + 4, h: 2 * other.radius + 4 }) * 4, 0)
      + Math.hypot(rectangle.x + w / 2 - point.x, rectangle.y + 6 - point.y);
    const best = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    occupied.push(best);
    placements.set(point.puma, { x: best.x - point.x, y: best.y - point.y + 10 });
  }
  return placements;
}

export class Scatterplot {
  constructor(host, type, model, radius, hooks) {
    this.host = host;
    this.type = type;
    this.domains = model.domains;
    this.radius = radius;
    this.hooks = hooks;
    this.svg = d3.select(host).append("svg").attr("role", "group");
    this.plot = this.svg.append("g");
    this.plot.append("g").attr("class", "grid");
    this.plot.append("line").attr("class", "zero-line");
    this.plot.append("g").attr("class", "axis x-axis");
    this.plot.append("g").attr("class", "axis y-axis");
    this.plot.append("text").attr("class", "axis-title x-title").attr("text-anchor", "middle");
    this.plot.append("text").attr("class", "axis-title y-title").attr("text-anchor", "middle");
    this.marksLayer = this.plot.append("g").attr("class", "marks-layer");
    this.emptyNote = this.svg.append("text").attr("fill", "#a0561a").attr("font-size", 10);
  }

  render(rows) {
    const fullWidth = this.host.clientWidth;
    const fullHeight = CHART_HEIGHT;
    const margin = { top: 28, right: 20, bottom: 56, left: 53 };
    const width = Math.max(120, fullWidth - margin.left - margin.right);
    const height = fullHeight - margin.top - margin.bottom;
    const xDomain = this.type === "growth" ? this.domains.xGrowth : this.domains.xBurden;
    const x = d3.scaleLinear(xDomain, [0, width]);
    const y = d3.scaleLinear(this.domains.y, [height, 0]);
    this.svg.attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`)
      .attr("data-year", rows[0].end_year).attr("data-y-min", this.domains.y[0]).attr("data-y-max", this.domains.y[1])
      .attr("data-x-min", xDomain[0]).attr("data-x-max", xDomain[1])
      .attr("aria-label", `${this.type === "growth" ? "Housing growth" : "2006 rent burden"} versus rent growth. Shared fixed Y scale ${this.domains.y.join(" to ")} percent.`);
    this.plot.attr("transform", `translate(${margin.left},${margin.top})`);
    const yTicks = d3.range(this.domains.y[0], this.domains.y[1] + 1, 10);
    this.plot.select(".grid").call(d3.axisLeft(y).tickValues(yTicks).tickSize(-width).tickFormat("")).selectAll(".tick line").attr("x1", 0);
    this.plot.select(".zero-line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0));
    this.plot.select(".x-axis").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(width < 260 ? 4 : 5).tickSizeOuter(0).tickPadding(7).tickFormat(d => `${d}%`));
    this.plot.select(".y-axis").call(d3.axisLeft(y).tickValues(yTicks).tickSizeOuter(0).tickSize(0).tickPadding(8).tickFormat(d => `${d}%`)).select(".domain").remove();
    this.plot.select(".x-title").attr("x", width / 2).attr("y", height + 43)
      .text(this.type === "growth" ? "Housing stock growth (%)" : "2006 rent-burdened households (%)");
    this.plot.select(".y-title").attr("transform", `translate(-40,${height / 2}) rotate(-90)`).text("Median gross rent growth (%)");
    const points = rows.map(row => ({ row, growth: rentGrowth(row), xValue: this.type === "growth" ? row.housing_growth_pct : row.rent_burden_pct_base }))
      .filter(d => isNumber(d.growth.value) && isNumber(d.xValue))
      .map(d => ({ ...d, puma: d.row.puma, x: x(d.xValue), y: y(d.growth.value), bound: d.growth.kind === "lower_bound", radius: this.type === "growth" ? this.radius(d.row.housing_units_end) : 12 }));
    const labels = labelPositions(points, width, height);
    // 大气泡在底层，小气泡仍可点击 / Draw larger bubbles first to keep small ones reachable.
    points.sort((a, b) => b.radius - a.radius);
    const marks = this.marksLayer.selectAll("g.scatter-mark").data(points, d => d.row.puma).join(enter => {
      const group = enter.append("g").attr("class", "data-mark scatter-mark");
      group.append("circle").attr("class", "hit-area").attr("fill", "transparent");
      group.append("path").attr("class", "mark-shape");
      group.append("text").attr("class", "point-label");
      return group;
    });
    marks.order().attr("transform", d => `translate(${d.x},${d.y})`)
      .classed("is-bound", d => d.bound).attr("data-rent-kind", d => d.growth.kind)
      .attr("data-y-value", d => d.growth.value).attr("data-year", d => d.row.end_year);
    marks.select(".hit-area").attr("r", d => Math.max(12, d.radius + 3));
    marks.select(".mark-shape").attr("d", d => {
      const type = this.type === "growth" ? d3.symbolCircle : REGION_SHAPES[d.row.region];
      const area = this.type === "growth" ? Math.PI * d.radius ** 2 : REGION_SYMBOL_AREA;
      return d3.symbol(type, area)();
    }).attr("data-area", d => this.type === "growth" ? Math.PI * d.radius ** 2 : REGION_SYMBOL_AREA);
    marks.select(".point-label").text(d => `${d.row.puma_short}${d.bound ? "*" : ""}`)
      .classed("is-bound-label", d => d.bound)
      .attr("x", d => labels.get(d.puma).x).attr("y", d => labels.get(d.puma).y);
    bindInteractions(marks, this.type, this.hooks);
    const missing = rows.length - points.length;
    this.emptyNote.attr("x", margin.left).attr("y", 14).text(missing ? `${missing} PUMA(s) have no plottable rent growth; still available on the map.` : "");
  }
}

export function renderLegends(color, domains, radius) {
  const svg = d3.select("#map-legend").attr("viewBox", "0 0 240 50");
  const gradient = svg.append("defs").append("linearGradient").attr("id", "housing-gradient");
  d3.range(0, 1.001, .05).forEach(t => gradient.append("stop").attr("offset", `${100 * t}%`).attr("stop-color", color(domains.mapRent[0] + t * (domains.mapRent[1] - domains.mapRent[0]))));
  svg.append("rect").attr("x", 20).attr("y", 5).attr("width", 200).attr("height", 11).attr("rx", 1).attr("fill", "url(#housing-gradient)");
  const scale = d3.scaleLinear(domains.mapRent, [20, 220]);
  svg.append("g").attr("transform", "translate(0,17)").call(d3.axisBottom(scale).tickValues([domains.mapRent[0], d3.mean(domains.mapRent), domains.mapRent[1]]).tickFormat(d => `$${formatInteger(d)}`).tickSize(3)).call(g => g.select(".domain").remove()).call(g => g.selectAll("text").attr("fill", "#677b80").attr("font-size", 10));
  const size = d3.select("#size-legend").attr("viewBox", "0 0 300 55");
  [50000, 100000, 150000].forEach((value, i) => {
    const x = 42 + i * 97;
    size.append("circle").attr("cx", x).attr("cy", 23).attr("r", radius(value)).attr("fill", "none").attr("stroke", "#809fa5");
    size.append("text").attr("x", x + 32).attr("y", 27).attr("fill", "#63777d").attr("font-size", 9).text(`${formatInteger(value / 1000)}k`);
  });
  const legend = d3.select("#region-legend");
  Object.entries(REGION_SHAPES).forEach(([name, type]) => {
    const item = legend.append("span").attr("class", "region-item");
    item.append("svg").attr("viewBox", "-12 -12 24 24").attr("aria-hidden", "true").append("path").attr("d", d3.symbol(type, 140)()).attr("fill", "#94b8bd").attr("stroke", "#365b63").attr("stroke-width", 1.7).attr("stroke-linejoin", "miter");
    item.append("span").text(name);
  });
}
