import { YEARS, buildModel, isNumber, formatInteger, formatPercent, formatRent, formatRentGrowth, escapeHTML } from "./model.mjs";

const d3 = globalThis.d3;
const $ = selector => document.querySelector(selector);
const state = { year: 2011, selected: new Set(), hovered: null };
const tooltip = $("#detail-tooltip");
const TOOLTIP_DELAY_MS = 400;
let model;
let charts = [];
let activeTooltip = null;
let tooltipTimer = null;
let pendingTooltip = null;

function tooltipHTML(row, view) {
  const current = model.annualByKey.get(`${state.year}:${row.puma}`);
  const base = model.annualByKey.get(`2006:${row.puma}`);
  const field = (label, value) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;
  let html = `<div class="tooltip-kicker">${escapeHTML(row.region)} · Census 2000 PUMA</div>
    <div class="tooltip-heading"><h3>PUMA ${escapeHTML(row.puma)}</h3><span>${state.year} <small>vs. 2006</small></span></div>
    <dl class="tooltip-metrics">
    ${view === "map" ? field("2006 median monthly gross rent", formatRent(base)) : ""}
    ${field(`${state.year} median monthly gross rent`, formatRent(current))}
    ${field(`${state.year} total housing units`, formatInteger(current.housing_units))}
    ${field("Housing growth from 2006", formatPercent(row.housing_growth_pct, true))}
    ${field("Nominal rent growth from 2006", formatRentGrowth(row))}</dl>`;
  if (view === "burden") {
    const burdenRow = (label, key, format) => `<tr><th scope="row">${label}</th><td>${format(base[key])}</td><td>${format(current[key])}</td></tr>`;
    html += `<table class="tooltip-burden"><caption>Rent burden · gross rent ≥30% of income</caption><thead><tr><th scope="col">Measure</th><th scope="col">2006</th><th scope="col">${state.year}</th></tr></thead><tbody>
      ${burdenRow("Burdened household share", "rent_burden_pct", formatPercent)}
      ${burdenRow("Burdened households", "rent_burdened_households", formatInteger)}
      ${burdenRow("Computable households", "rent_computable_households", formatInteger)}
      </tbody></table><p class="tooltip-note">Share = burdened ÷ computable households. Not-computed cases are excluded from the denominator.</p>`;
  }
  html += `<p class="tooltip-note">Click to select · Ctrl-click to add or remove</p>`;
  return html;
}

function positionTooltip(event, element) {
  const rect = element?.getBoundingClientRect();
  const x = isNumber(event?.clientX) ? event.clientX : rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const y = isNumber(event?.clientY) ? event.clientY : rect ? rect.top + rect.height / 2 : innerHeight / 2;
  const box = tooltip.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  let left = x + 22;
  if (left + box.width > viewportWidth - 12) left = x - box.width - 22;
  tooltip.style.left = `${Math.max(12, Math.min(viewportWidth - box.width - 12, left))}px`;
  tooltip.style.top = `${Math.max(12, Math.min(innerHeight - box.height - 12, y - box.height * .35))}px`;
}

function applyHighlights() {
  const active = new Set(state.selected);
  if (state.hovered) active.add(state.hovered);
  document.querySelectorAll(".data-mark").forEach(mark => {
    const puma = mark.dataset.puma;
    mark.classList.toggle("is-selected", state.selected.has(puma));
    mark.classList.toggle("is-hovered", state.hovered === puma);
    mark.classList.toggle("is-dimmed", active.size > 0 && !active.has(puma));
    mark.setAttribute("aria-pressed", String(state.selected.has(puma)));
  });
  $("#clear-selection").disabled = state.selected.size === 0;
  $("#selection-status").textContent = state.selected.size ? `${state.selected.size} selected · ${[...state.selected].sort().map(puma => puma.slice(-2)).join(", ")}` : "All 10 PUMAs";
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  pendingTooltip = null;
  tooltip.hidden = true;
  if (activeTooltip) activeTooltip.removeAttribute("aria-describedby");
  activeTooltip = null;
  state.hovered = null;
  applyHighlights();
}

function showTooltip(event, row, view, element) {
  activeTooltip = element;
  tooltip.innerHTML = tooltipHTML(row, view);
  tooltip.hidden = false;
  element.setAttribute("aria-describedby", "detail-tooltip");
  positionTooltip(event, element);
}

const hooks = {
  hover(event, row, view, element) {
    const keyboardFocus = event.type === "focus" && element.matches(":focus-visible");
    // 鼠标点击引起的 focus 不绕过悬停等待 / Pointer focus must not bypass the hover delay.
    if (event.type === "focus" && !keyboardFocus) return;
    hideTooltip();
    state.hovered = row.puma;
    applyHighlights();
    if (keyboardFocus) {
      showTooltip(null, row, view, element);
      return;
    }
    // 移开、切换年份或清除时取消 / Cancel pending details on leave, year change or reset.
    pendingTooltip = { row, view, element, position: { clientX: event.clientX, clientY: event.clientY } };
    tooltipTimer = setTimeout(() => {
      const pending = pendingTooltip;
      tooltipTimer = null;
      pendingTooltip = null;
      if (pending?.element.isConnected) showTooltip(pending.position, pending.row, pending.view, pending.element);
    }, TOOLTIP_DELAY_MS);
  },
  move(event) {
    if (pendingTooltip) pendingTooltip.position = { clientX: event.clientX, clientY: event.clientY };
    if (!tooltip.hidden) positionTooltip(event, activeTooltip);
  },
  leave: hideTooltip,
  select(puma, additive) {
    if (additive) state.selected.has(puma) ? state.selected.delete(puma) : state.selected.add(puma);
    else state.selected = state.selected.size === 1 && state.selected.has(puma) ? new Set() : new Set([puma]);
    applyHighlights();
  },
};

function render() {
  const rows = model.comparisonsByYear.get(state.year);
  $("#end-year").textContent = state.year;
  $("#dashboard").dataset.year = state.year;
  document.querySelectorAll(".period-label").forEach(label => { label.textContent = `2006 → ${state.year}`; });
  document.querySelectorAll(".endpoint-year").forEach(label => { label.textContent = state.year; });
  document.querySelectorAll(".year-buttons button").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.year) === state.year)));
  charts.forEach(chart => chart.render(rows));
  applyHighlights();
}

async function start() {
  try {
    if (!d3) throw new Error("The local D3 library did not load.");
    const { HousingMap, Scatterplot, renderLegends } = await import("./charts.mjs?v=mainland-20261112");
    const [annual, comparisons, geography] = await Promise.all([
      d3.json("./data/manhattan_annual_2006_2011.json"),
      d3.json("./data/manhattan_comparisons_from_2006.json"),
      d3.json("./data/manhattan_puma_2000_land.geojson?v=mainland-20261112"),
    ]);
    model = buildModel(annual, comparisons, geography);
    const domains = model.domains;
    const color = d3.scaleSequential(d3.interpolateLab("#e3f0ec", "#003b46")).domain(domains.mapRent).clamp(true);
    // 套数与直径成正比，跨年份比例固定 / Diameter is proportional to total units across all years.
    const radius = d3.scaleLinear([0, domains.maxHousing], [0, 23]);
    const buttons = d3.select("#year-buttons").selectAll("button").data(YEARS).join("button").attr("type", "button")
      .attr("data-year", year => year).attr("aria-label", year => `Compare 2006 to ${year}`).text(year => year)
      .on("click", (_, year) => { hideTooltip(); state.year = year; render(); });
    buttons.attr("aria-pressed", year => String(year === state.year));
    $("#clear-selection").addEventListener("click", () => { state.selected.clear(); hideTooltip(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { state.selected.clear(); hideTooltip(); }
    });
    // 同一状态驱动全部视图 / One shared state drives all three views.
    charts = [new HousingMap($("#map-chart"), model, color, hooks),
      new Scatterplot($("#growth-chart"), "growth", model, radius, hooks),
      new Scatterplot($("#burden-chart"), "burden", model, radius, hooks)];
    renderLegends(color, domains, radius);
    $("#load-status").hidden = true;
    $("#dashboard").hidden = false;
    render();
    let frame;
    new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { hideTooltip(); render(); });
    }).observe($(".dashboard-grid"));
  } catch (error) {
    const status = $("#load-status");
    status.hidden = false;
    status.classList.add("is-error");
    status.innerHTML = `<strong>The dashboard could not load.</strong><br>${escapeHTML(error.message)}<br>Run <code>python serve.py</code> from the Week_7_Submission folder, then open <a href="http://127.0.0.1:8765/">the dashboard</a>.`;
    console.error(error);
  }
}

start();
