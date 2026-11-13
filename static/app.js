"use strict";
// LotFinder front end. Everything user- or source-supplied goes in via textContent.

const $ = (id) => document.getElementById(id);
const usd = (cents) =>
  (cents < 0 ? "-$" : "$") + Math.round(Math.abs(cents) / 100).toLocaleString("en-US");

// Opens the car's Kelley Blue Book page to compare values (KBB has no public API).
function kbbLink(year, make, model) {
  const url = window.LotScore && LotScore.kbbUrl(year, make, model);
  return url ? el("p", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "Check the KBB value ↗" })) : null;
}

// Where the value comes from, in a few words (card) or a sentence (details).
function valueChip(lot) {
  const b = lot.value_basis || {};
  if (b.kind === "ebay") return `Value: eBay median of ${b.n} listings${b.few ? " (few)" : ""}`;
  if (b.kind === "none") return "No value figure for this car";
  return "Value: rough built-in estimate";
}

// Mechanic's specials: what the seller says is wrong, in their words.
function sellerSays(sp) {
  if (!sp) return "";
  const q = sp.faults.length ? sp.faults[0].quote : sp.vague_quote;
  return q ? `Seller: “${q}”` : "";
}

function maxBidText(sp) {
  if (!sp) return "";
  const pct = Math.round(sp.target_roi * 100);
  if (sp.unclear) return "Fault not stated: no max bid";
  return sp.max_bid_cents > 0 ? `Max bid for ${pct}% ROI: ${usd(sp.max_bid_cents)}` : `No bid makes ${pct}% ROI`;
}

function valueLines(d) {
  const b = d.value_basis || {};
  const link = (url, text) => el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text });
  const out = [];
  if (b.kind === "ebay") {
    out.push(el("p", {}, `Value from ${b.n} clean-title eBay Motors listings, ${b.years[0]}–${b.years[1]} ${d.make} ${d.model}: ` +
      `${usd(b.low_cents)} to ${usd(b.high_cents)}, median ${usd(b.median_cents)}. Asking prices run high, so it is taken ` +
      `${Math.round(b.trim * 100)}% lower, then adjusted for this car's miles and ${d.title_type} title. `, link(b.url, "See the listings ↗")));
  } else {
    const few = b.n ? `only ${b.n} comparable eBay listing${b.n === 1 ? "" : "s"}` : "no comparable eBay listings";
    out.push(el("p", {}, b.kind === "none"
      ? `No value: ${few} and no built-in figure for this car. `
      : `Rough built-in estimate (${few}, too few to trust). `, b.url ? link(b.url, "Search eBay ↗") : null));
  }
  const c = d.value_check;
  if (c) {
    out.push(el("p", {}, `Google check: prices in ${c.n} search results run ${usd(c.low_cents)} to ${usd(c.high_cents)}, ` +
      `median ${usd(c.median_cents)} (not used in the margin). `, link(c.url, "See the search ↗")));
  }
  return out;
}

// Used parts prices on eBay that fit this car: shown for the buyer, not added to the margin.
function partsTable(d) {
  const rows = d.parts_prices ? Object.values(d.parts_prices) : [];
  if (!rows.length) return [];
  const link = (url, text) => el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text });
  const table = el("table", {});
  for (const p of rows) {
    table.append(el("tr", {},
      el("td", { text: p.label }),
      el("td", { class: "n", text: p.median_cents != null ? usd(p.median_cents) : "—" }),
      el("td", { class: "small", text: p.median_cents != null ? `${usd(p.low_cents)}–${usd(p.high_cents)}, ${p.n} listings` : "too few listings" }),
      el("td", {}, link(p.url, "eBay ↗"))));
  }
  const note = d.special
    ? "Median price of Buy It Now listings that fit this year, make and model (used where that is how the part is bought). The parts the fault needs are in the cost below; \u201conly if worse\u201d parts are in the worst case."
    : "Median price of used Buy It Now listings whose fitment matches this year, make and model. Not added to the margin: you pick the parts it needs.";
  return [el("h4", { text: d.special ? "Parts to buy (eBay)" : "Used parts on eBay that fit this car" }), table,
    el("p", { class: "small", text: note })];
}

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
let zip3 = null; // ZIP area centres, loaded once

// Your ZIP and distance: transport is re-quoted by road miles instead of the flat figure,
// and profit, ROI and the max bid move with it. Returns a copy; null miles: unknown.
function withDistance(lot) {
  const home = ($("zip").value || "").trim();
  if (!/^\d{5}$/.test(home) || !zip3 || !lot.zip3) return { ...lot, miles: null };
  const miles = LotScore.milesBetween(home, lot.zip3, zip3);
  const quote = LotScore.transportCents(miles);
  if (quote == null) return { ...lot, miles: null };
  const delta = quote - lot.transport_cents;
  const allIn = lot.all_in_cents + delta;
  const margin = lot.margin_cents - delta;
  const out = { ...lot, miles, transport_cents: quote, all_in_cents: allIn, margin_cents: margin,
    margin_pct: allIn ? Math.round((1000 * margin) / allIn) / 10 : 0 };
  if (lot.margin_low_cents != null) out.margin_low_cents = lot.margin_low_cents - delta;
  if (lot.margin_high_cents != null) out.margin_high_cents = lot.margin_high_cents - delta;
  if (lot.special && !lot.special.unclear) {
    const top = lot.special.max_bid_cents - Math.round(delta / (1 + lot.special.target_roi));
    out.special = { ...lot.special, max_bid_cents: Math.max(0, top) };
  }
  return out;
}

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
  const within = Number($("within").value) || 0;
  lots = lots.map(withDistance);
  if (within) lots = lots.filter((l) => l.miles != null && l.miles <= within);
  lots.sort((a, b) => b.margin_cents - a.margin_cents);
  // Lots whose photos were analyzed first: an unanalyzed margin leaves repairs out.
  lots = [...lots.filter((l) => l.photos_read), ...lots.filter((l) => !l.photos_read)];
  // Specials with a stated fault and a value first; unclear faults and unknown values after.
  const priced = (l) => !l.special || (!l.special.unclear && (l.value_basis || {}).kind !== "none");
  lots = [...lots.filter(priced), ...lots.filter((l) => !priced(l))];
  const list = $("results");
  list.replaceChildren();
  $("status").textContent = lots.length
    ? `${lots.length} mechanic's special${lots.length === 1 ? "" : "s"}, best margin first`
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
          text: `${lot.odometer_mi.toLocaleString("en-US")} mi · ${lot.location}` +
            (lot.miles != null ? ` · ≈${lot.miles.toLocaleString("en-US")} mi away` : "") + ` · ${lot.source}`,
        }),
        lot.special ? el("div", { class: "seller", text: sellerSays(lot.special) }) : null,
        el(
          "div",
          { class: "chips" },
          el("span", { class: "chip", text: lot.title_type + " title" }),
          lot.primary_damage ? el("span", { class: "chip", text: lot.primary_damage }) : null,
          ...(lot.special
            ? (lot.special.faults.length
                ? lot.special.faults.map((f) => el("span", { class: "chip fault", text: f.label }))
                : [el("span", { class: "chip fault", text: "Diagnosis unclear" })])
            : []),
          lot.source === "ebay" ? el("span", { class: "chip", text: "Live eBay listing" }) : el("span", { class: "chip", text: "Sample lot" }),
          lot.special
            ? el("span", { class: "chip est", text: lot.special.unclear ? "Parts not priced" : `Parts ${usd(lot.repairs_cents)} (worst ${usd(lot.repairs_high_cents)})` })
            : lot.photos_read
            ? el("span", {
                class: "chip est",
                text: `Est. repairs ${usd(lot.repairs_low_cents)}–${usd(lot.repairs_high_cents)}`,
              })
            : el("span", { class: "chip est", text: "Photos not analyzed yet" }),
          lot.photos_read && !lot.special ? el("span", { class: "chip", text: `${lot.parts_to_replace} parts to replace` }) : null,
          el("span", { class: "chip", text: valueChip(lot) }),
        ),
      ),
      el(
        "div",
        { class: "money" },
        el("div", { class: "margin " + marginClass, text: usd(lot.margin_cents) }),
        el("div", { class: "small", text: lot.special ? `profit at this price · ROI ${lot.margin_pct}%` : lot.photos_read ? `est. margin · ${lot.margin_pct}%` : "margin before repairs" }),
        el("div", { class: "small", text: `all-in ${usd(lot.all_in_cents)} · price ${usd(lot.bid_cents)}` }),
        lot.miles != null ? el("div", { class: "small", text: `transport ≈${usd(lot.transport_cents)}` }) : null,
        lot.special ? el("div", { class: "small maxbid", text: maxBidText(lot.special) }) : null,
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
    d = withDistance(await getJSON(API.lot(id)));
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
  if (!d.repair_lines.length) {
    const none = d.photos_read
      ? "No damage found in the photos."
      : "Photo analysis is not switched on yet, so repairs are not estimated: the margin below assumes no repairs.";
    parts.append(el("tr", {}, el("td", { colspan: "5", text: none })));
  }

  const sp = d.special;
  const cost = el("table", {}, row(sp ? "Price now (bid or Buy It Now)" : "Current bid", d.bid_cents));
  for (const f of d.fees) cost.append(row(f.name, f.cents));
  cost.append(
    row(sp ? `Parts, used from eBay (cheapest ${usd(d.repairs_low_cents)}, worst case ${usd(d.repairs_high_cents)})`
      : `Estimated repairs (${usd(d.repairs_low_cents)}–${usd(d.repairs_high_cents)})`, d.repairs_cents),
    row(d.miles != null ? `Transport (≈${d.miles.toLocaleString("en-US")} road mi, estimate)` : "Transport (flat estimate: enter your ZIP)", d.transport_cents),
    row("All-in cost", d.all_in_cents, "total"),
    row(sp ? "Sells for, running, good condition" : "Market value once repaired", d.market_value_cents),
    row(`Estimated ${sp ? "profit" : "margin"} (${usd(d.margin_low_cents)} to ${usd(d.margin_high_cents)})`, d.margin_cents, "total"),
  );
  const special = sp
    ? [
        el("h4", { text: "What the seller says is wrong" }),
        sp.faults.length
          ? el("ul", {}, ...sp.faults.map((f) => el("li", {}, el("b", { text: f.label + ": " }), `“${f.quote}”`)))
          : el("p", { text: `Diagnosis unclear: “${sp.vague_quote}”. Ask the seller what is wrong before bidding.` }),
        el("p", { class: "maxbid", text: maxBidText(sp) + (sp.unclear ? "" : ` (ROI ${d.margin_pct}% at today's price)`) }),
      ]
    : [];

  body.replaceChildren(...[
    el("h2", { text: d.title }),
    el("div", { class: "meta", text: `${d.odometer_mi.toLocaleString("en-US")} mi · ${d.location} · ${d.source} · ${d.title_type} title · ends ${d.ends}` }),
    photos,
    d.url ? el("p", {}, el("a", { href: d.url, target: "_blank", rel: "noopener noreferrer", text: "View this listing on eBay ↗" })) : null,
    ...special,
    ...valueLines(d),
    kbbLink(d.year, d.make, d.model),
    sp ? el("div", { class: "notice", text: "Estimate only. Parts are read from the seller's description and priced from used eBay listings that fit this car; your own labor is not counted. Check the car before you buy: sellers can be wrong about what is broken." }) : el("div", {
      class: "notice",
      text: d.photos_read
        ? "Estimate only. Parts were read from the photos and priced at a shop rate of " +
          usd(d.labor_rate_cents) + "/h; hidden damage (frame, flood, electrical) is not visible in photos."
        : "These photos have not been analyzed yet, so the cost below leaves repairs out. Look at the photos and the eBay listing before you bid.",
    }),
    ...partsTable(d),
    ...(sp ? [] : [el("h4", { text: "Parts to replace or repair" }), parts]),
    el("h4", { text: "What it really costs" }),
    cost,
  ].filter((x) => x != null));
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
  try {
    $("zip").value = localStorage.getItem("lf-zip") || "";
    $("within").value = localStorage.getItem("lf-within") || "";
  } catch {
    /* storage blocked: start empty */
  }
  for (const id of ["zip", "within"]) {
    $(id).addEventListener("change", () => {
      try {
        localStorage.setItem("lf-" + id, $(id).value);
      } catch {
        /* storage blocked: not remembered */
      }
    });
  }
  try {
    zip3 = await getJSON(STATIC ? "static/zip3.json" : "static/zip3.json");
  } catch {
    zip3 = null; // distances off; everything else works
  }
  $("search").addEventListener("submit", (e) => {
    e.preventDefault();
    search();
  });
  search();
}

init();
