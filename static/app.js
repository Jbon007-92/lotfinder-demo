"use strict";
// LotFinder front end. Everything user- or source-supplied goes in via textContent.

const $ = (id) => document.getElementById(id);
const usd = (cents) =>
  (cents < 0 ? "-$" : "$") + Math.round(Math.abs(cents) / 100).toLocaleString("en-US");

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

let meta = { makes: {}, years: [] };

// Static mode (GitHub Pages): the same JSON as the API, pre-built as files, filtered here.
const STATIC = document.documentElement.dataset.static === "1";
const API = {
  meta: () => (STATIC ? "api/meta.json" : "api/meta"),
  lots: (params) => (STATIC ? "api/lots.json" : "api/lots?" + params),
  lot: (id) => "api/lots/" + encodeURIComponent(id) + (STATIC ? ".json" : ""),
};
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function keep(lot, params) {
  const make = params.get("make");
  const model = params.get("model");
  const year = params.get("year");
  return (!make || same(lot.make, make)) && (!model || same(lot.model, model)) && (!year || String(lot.year) === year);
}

function fillOptions(select, values, anyLabel) {
  select.replaceChildren(el("option", { value: "", text: anyLabel }));
  for (const v of values) select.append(el("option", { value: String(v), text: String(v) }));
}

function syncModels() {
  const models = meta.makes[$("make").value] || [];
  fillOptions($("model"), models, "Any model");
  $("model").disabled = models.length === 0;
}

async function getJSON(url) {
  const resp = await fetch(url);
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error || resp.statusText);
  return body;
}

async function search() {
  const params = new URLSearchParams();
  for (const name of ["make", "model", "year"]) {
    const v = $(name).value;
    if (v) params.set(name, v);
  }
  history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
  $("status").textContent = "Searching…";
  try {
    const { lots } = await getJSON(API.lots(params));
    render(STATIC ? lots.filter((lot) => keep(lot, params)) : lots);
  } catch (err) {
    $("status").textContent = "Search failed: " + err.message;
  }
}

function render(lots) {
  const list = $("results");
  list.replaceChildren();
  $("status").textContent = lots.length
    ? `${lots.length} lot${lots.length === 1 ? "" : "s"}, best margin first`
    : "No lots match that make, model and year.";
  lots.forEach((lot, i) => {
    const marginClass = lot.margin_cents >= 0 ? "pos" : "neg";
    const card = el(
      "li",
      { class: "deal", tabindex: "0" },
      el("div", { class: "rank", text: String(i + 1) }),
      el("img", { src: lot.thumb, alt: lot.title + " photo", loading: "lazy" }),
      el(
        "div",
        {},
        el("h3", { text: lot.title }),
        el("div", {
          class: "meta",
          text: `${lot.odometer_mi.toLocaleString("en-US")} mi · ${lot.location} · ${lot.source}`,
        }),
        el(
          "div",
          { class: "chips" },
          el("span", { class: "chip", text: lot.title_type + " title" }),
          lot.primary_damage ? el("span", { class: "chip", text: lot.primary_damage }) : null,
          el("span", {
            class: "chip est",
            text: `Est. repairs ${usd(lot.repairs_low_cents)}–${usd(lot.repairs_high_cents)}`,
          }),
          el("span", { class: "chip", text: `${lot.parts_to_replace} parts to replace` }),
        ),
      ),
      el(
        "div",
        { class: "money" },
        el("div", { class: "margin " + marginClass, text: usd(lot.margin_cents) }),
        el("div", { class: "small", text: `est. margin · ${lot.margin_pct}%` }),
        el("div", { class: "small", text: `all-in ${usd(lot.all_in_cents)} · bid ${usd(lot.bid_cents)}` }),
      ),
    );
    const open = () => openLot(lot.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    list.append(card);
  });
}

function row(label, cents, cls = "") {
  return el("tr", { class: cls }, el("td", { text: label }), el("td", { class: "n", text: usd(cents) }));
}

async function openLot(id) {
  let d;
  try {
    d = await getJSON(API.lot(id));
  } catch (err) {
    $("status").textContent = "Could not load lot: " + err.message;
    return;
  }
  const body = $("lot-body");
  const photos = el("div", { class: "photos" });
  for (const p of d.photos) photos.append(el("img", { src: p.url, alt: p.angle || "photo" }));

  const parts = el(
    "table",
    {},
    el(
      "tr",
      {},
      el("th", { text: "Part" }),
      el("th", { text: "Work" }),
      el("th", { class: "n", text: "Part" }),
      el("th", { class: "n", text: "Labor" }),
      el("th", { class: "n", text: "Est." }),
    ),
  );
  for (const line of d.repair_lines) {
    const label = line.label + (line.known_part ? "" : " (unlisted, default price)");
    const conf = `${Math.round(line.confidence * 100)}% sure`;
    parts.append(
      el(
        "tr",
        {},
        el("td", {}, el("div", { text: label }), el("div", { class: "small", text: [conf, line.note].filter(Boolean).join(" · ") })),
        el("td", { text: line.action }),
        el("td", { class: "n", text: usd(line.part_cents) }),
        el("td", { class: "n", text: `${line.labor_hours} h · ${usd(line.labor_cents)}` }),
        el("td", { class: "n", text: usd(line.total_cents) }),
      ),
    );
  }
  if (!d.repair_lines.length) parts.append(el("tr", {}, el("td", { colspan: "5", text: "No damage found in the photos." })));

  const cost = el("table", {}, row("Current bid", d.bid_cents));
  for (const f of d.fees) cost.append(row(f.name, f.cents));
  cost.append(
    row(`Estimated repairs (${usd(d.repairs_low_cents)}–${usd(d.repairs_high_cents)})`, d.repairs_cents),
    row("Transport (flat estimate)", d.transport_cents),
    row("All-in cost", d.all_in_cents, "total"),
    row("Market value once repaired", d.market_value_cents),
    row(`Estimated margin (${usd(d.margin_low_cents)} to ${usd(d.margin_high_cents)})`, d.margin_cents, "total"),
  );

  body.replaceChildren(
    el("h2", { text: d.title }),
    el("div", { class: "meta", text: `${d.odometer_mi.toLocaleString("en-US")} mi · ${d.location} · ${d.source} · ${d.title_type} title · ends ${d.ends}` }),
    photos,
    el("div", {
      class: "notice",
      text: "Estimate only. Parts were read from the photos and priced at a shop rate of " +
        usd(d.labor_rate_cents) + "/h; hidden damage (frame, flood, electrical) is not visible in photos.",
    }),
    el("h4", { text: "Parts to replace or repair" }),
    parts,
    el("h4", { text: "What it really costs" }),
    cost,
  );
  $("lot").showModal();
}

async function init() {
  try {
    meta = await getJSON(API.meta());
  } catch (err) {
    $("status").textContent = "Could not load makes: " + err.message;
  }
  fillOptions($("make"), Object.keys(meta.makes), "Any make");
  fillOptions($("year"), meta.years, "Any year");
  const q = new URLSearchParams(location.search);
  if (q.get("make")) $("make").value = q.get("make");
  syncModels();
  if (q.get("model")) $("model").value = q.get("model");
  if (q.get("year")) $("year").value = q.get("year");
  $("make").addEventListener("change", syncModels);
  $("search").addEventListener("submit", (e) => {
    e.preventDefault();
    search();
  });
  search();
}

init();
