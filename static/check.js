"use strict";
// Check a lot: the user's own details and parts list, scored in the browser by score.js.
// Nothing typed or chosen here (link, details, photos) is sent anywhere.

const $ = (id) => document.getElementById(id);
const usd = (cents) =>
  (cents < 0 ? "-$" : "$") + Math.round(Math.abs(cents) / 100).toLocaleString("en-US");
const STATIC = document.documentElement.dataset.static === "1";

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

// Copart and IAAI lot links only; returns {source, lotNumber, url} or null.
function parseLink(text) {
  let u;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const num = (u.pathname.match(/(\d{6,10})/) || [])[1] || "";
  if (host === "copart.com" || host.endsWith(".copart.com")) return { source: "copart", lotNumber: num, url: u.href };
  if (host === "iaai.com" || host.endsWith(".iaai.com")) return { source: "iaai", lotNumber: num, url: u.href };
  return null;
}

let pricing = null;
const dollars = (id) => {
  const v = $(id).value.trim();
  return v === "" ? null : Math.round(Number(v) * 100);
};

function buildParts() {
  const box = $("parts");
  for (const p of pricing.parts) {
    const select = el(
      "select",
      { "data-part": p.part, "aria-label": p.label },
      el("option", { value: "", text: "OK" }),
      el("option", { value: "replace", text: "Replace" }),
    );
    if (p.repair_hours > 0) select.append(el("option", { value: "repair", text: "Repair" }));
    box.append(el("label", { class: "part" }, el("span", { text: p.label }), select));
  }
}

function fillLists() {
  const rows = pricing.values ? pricing.values.table : [];
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  $("makes").replaceChildren(...[...new Set(rows.map((r) => cap(r[0])))].map((m) => el("option", { value: m })));
  $("models").replaceChildren(...rows.map((r) => el("option", { value: r[1] === "f-150" ? "F-150" : r[1] === "mx-5 miata" ? "MX-5 Miata" : cap(r[1]) })));
  $("transport").value = String(pricing.transport_cents / 100);
}

function showPhotos() {
  const box = $("previews");
  for (const img of box.querySelectorAll("img")) URL.revokeObjectURL(img.src);
  box.replaceChildren();
  for (const file of [...$("photos").files].slice(0, 24)) {
    if (!file.type.startsWith("image/")) continue;
    box.append(el("img", { src: URL.createObjectURL(file), alt: file.name }));
  }
}

function row(label, cents, cls = "") {
  return el("tr", { class: cls }, el("td", { text: label }), el("td", { class: "n", text: usd(cents) }));
}

function check(e) {
  e.preventDefault();
  $("error").textContent = "";
  const link = parseLink($("link").value);
  const year = Number($("year").value);
  const make = $("make").value.trim();
  const model = $("model").value.trim();
  const bid = dollars("bid");
  const problems = [];
  if (!link) problems.push("paste a copart.com or iaai.com lot link");
  if (!(year >= 1980 && year <= 2027)) problems.push("enter the year");
  if (!make || !model) problems.push("enter the make and model");
  if (bid == null || bid < 0) problems.push("enter the current bid");
  if (problems.length) {
    $("error").textContent = "Please " + problems.join(", ") + ".";
    return;
  }
  const lot = {
    source: link.source,
    year,
    make,
    model,
    odometer_mi: Math.max(0, Math.round(Number($("miles").value) || 0)),
    title_type: $("title").value,
    current_bid_cents: bid,
  };
  const findings = [...document.querySelectorAll("#parts select")]
    .filter((s) => s.value)
    .map((s) => ({ part: s.dataset.part, action: s.value, confidence: 1.0 }));
  const typedValue = dollars("value");
  const d = LotScore.score(pricing, lot, findings, typedValue, dollars("transport"));
  render(link, lot, d, typedValue == null);
}

function render(link, lot, d, valueEstimated) {
  const out = $("result");
  const parts = el("table", {}, el("tr", {}, el("th", { text: "Part" }), el("th", { text: "Work" }), el("th", { class: "n", text: "Part" }), el("th", { class: "n", text: "Labor" }), el("th", { class: "n", text: "Est." })));
  for (const l of d.repair_lines) {
    parts.append(el("tr", {}, el("td", { text: l.label }), el("td", { text: l.action }), el("td", { class: "n", text: usd(l.part_cents) }), el("td", { class: "n", text: `${l.labor_hours} h · ${usd(l.labor_cents)}` }), el("td", { class: "n", text: usd(l.total_cents) })));
  }
  if (!d.repair_lines.length) parts.append(el("tr", {}, el("td", { colspan: "5", text: "No parts ticked: the cost below has no repairs." })));
  const cost = el("table", {}, row("Current bid", d.bid_cents));
  for (const f of d.fees) cost.append(row(f.name, f.cents));
  cost.append(
    row("Estimated repairs", d.repairs_cents),
    row("Transport", d.transport_cents),
    row("All-in cost", d.all_in_cents, "total"),
    row(valueEstimated ? "Market value once repaired (LotFinder estimate)" : "Market value once repaired (yours)", d.market_value_cents),
    row("Estimated margin", d.margin_cents, "total"),
  );
  const unknownValue = valueEstimated && d.market_value_cents === 0;
  const name = lot.source === "copart" ? "Copart" : "IAAI";
  const kids = [
    el("h2", { text: `${lot.year} ${lot.make} ${lot.model}` }),
    el("p", { class: "meta" }, `${name}${link.lotNumber ? " lot " + link.lotNumber : ""} · `, el("a", { href: link.url, target: "_blank", rel: "noopener noreferrer", text: "open the listing ↗" })),
    el("div", { class: "margin " + (d.margin_cents >= 0 ? "pos" : "neg"), text: `${usd(d.margin_cents)} est. margin (${d.margin_pct}%)` }),
    unknownValue ? el("div", { class: "notice", text: "LotFinder has no value figures for this make and model yet: enter the market value above for a real margin." }) : null,
    el("h4", { text: "Parts to replace or repair" }),
    parts,
    el("h4", { text: "What it really costs" }),
    cost,
  ];
  out.replaceChildren(...kids.filter((k) => k != null));
  out.hidden = false;
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function init() {
  try {
    const resp = await fetch(STATIC ? "api/pricing.json" : "api/pricing");
    if (!resp.ok) throw new Error(resp.statusText);
    pricing = await resp.json();
  } catch (err) {
    $("error").textContent = "Could not load the price tables: " + err.message;
    return;
  }
  buildParts();
  fillLists();
  $("photos").addEventListener("change", showPhotos);
  $("check").addEventListener("submit", check);
}

init();
