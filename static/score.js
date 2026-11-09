"use strict";
// The deal math of lotfinder/core (fees.py, repairs.py, deal.py) and the table valuer
// (adapters/fakes.py), for scoring a lot in the browser. Same tables (api/pricing.json),
// same order of operations, same rounding: tests/unit/test_score_js.py checks every
// result against the Python core to the cent. Change both sides together.

(function (root) {
  const roundCents = (v) => Math.floor(v + 0.5); // Python int(v + 0.5) for v >= 0

  function buyerFee(schedule, price) {
    if (price < 0) throw new Error("price cannot be negative");
    for (const [upTo, fixed, bp] of schedule.tiers) {
      if (upTo === null || price <= upTo) return fixed + Math.floor((price * bp + 5000) / 10000);
    }
    throw new Error("price is above the last tier");
  }

  function feeLines(schedule, price) {
    return [["Buyer fee", buyerFee(schedule, price)], ...schedule.flat];
  }

  function priceFinding(f, pricing) {
    const table = pricing.partsByKey;
    const known = Object.prototype.hasOwnProperty.call(table, f.part);
    const p = known ? table[f.part] : pricing.default_part;
    const replace = f.action === "replace";
    const partCents = replace ? p.part_cents : 0;
    const hours = replace ? p.replace_hours : p.repair_hours;
    const laborCents = roundCents(hours * pricing.labor_rate_cents);
    const total = partCents + laborCents;
    const doubt = 1.0 - f.confidence;
    return {
      part: f.part,
      label: known ? p.label : f.part.replaceAll("_", " "),
      action: f.action,
      part_cents: partCents,
      labor_hours: hours,
      labor_cents: laborCents,
      total_cents: total,
      low_cents: roundCents(total * (1.0 - doubt * pricing.low_spread)),
      high_cents: roundCents(total * (1.0 + doubt * pricing.high_spread)),
      confidence: f.confidence,
      known_part: known,
      note: f.note || "",
    };
  }

  function estimate(findings, pricing) {
    const lines = findings.map((f) => priceFinding(f, pricing));
    const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
    return { lines, total_cents: sum("total_cents"), low_cents: sum("low_cents"), high_cents: sum("high_cents") };
  }

  function marketValue(lot, v) {
    if (!v) return 0;
    const row = v.table.find(([mk, md]) => mk === lot.make.toLowerCase() && md === lot.model.toLowerCase());
    if (!row) return 0;
    const [, , base, refYear] = row;
    let value = base * (1.0 - v.depreciation_per_year) ** (refYear - lot.year);
    const expected = v.ref_miles * Math.max(v.now_year - lot.year, 1);
    const adj = (expected - lot.odometer_mi) * v.per_mile_cents;
    const cap = value * v.mileage_cap;
    value += Math.max(-cap, Math.min(cap, adj));
    const disc = Object.prototype.hasOwnProperty.call(v.title_discount, lot.title_type)
      ? v.title_discount[lot.title_type]
      : v.default_title_discount;
    value *= 1.0 - disc;
    return Math.max(Math.trunc(value), 0);
  }

  // Python round(x, 1): round half to even on the exact binary value.
  function round1(x) {
    const lo = Math.floor(x * 10);
    if ((lo + 0.5) / 10 === x) return (lo % 2 === 0 ? lo : lo + 1) / 10; // exact tie: to even
    return Number(x.toFixed(1)); // toFixed also rounds the exact binary value
  }

  function prepare(pricing) {
    if (!pricing.partsByKey) {
      pricing.partsByKey = Object.fromEntries(pricing.parts.map((p) => [p.part, p]));
    }
    return pricing;
  }

  // lot: {source, year, make, model, odometer_mi, title_type, current_bid_cents}
  // findings: [{part, action, confidence, note}]; marketValueCents overrides the valuer.
  function score(pricing, lot, findings, marketValueCents, transportCents) {
    prepare(pricing);
    const schedule = pricing.fees[lot.source];
    if (!schedule) throw new Error("no fee schedule for " + lot.source);
    const bid = lot.current_bid_cents;
    const transport = transportCents == null ? pricing.transport_cents : transportCents;
    const market = marketValueCents == null ? marketValue(lot, pricing.values) : marketValueCents;
    if (bid < 0 || transport < 0 || market < 0) throw new Error("bid, transport and market value cannot be negative");
    const fees = feeLines(schedule, bid);
    const feesCents = fees.reduce((a, [, c]) => a + c, 0);
    const repairs = estimate(findings, pricing);
    const fixed = bid + feesCents + transport;
    const allIn = fixed + repairs.total_cents;
    const margin = market - allIn;
    return {
      bid_cents: bid,
      fees: fees.map(([name, cents]) => ({ name, cents })),
      fees_cents: feesCents,
      repairs_cents: repairs.total_cents,
      repairs_low_cents: repairs.low_cents,
      repairs_high_cents: repairs.high_cents,
      repair_lines: repairs.lines,
      transport_cents: transport,
      all_in_cents: allIn,
      market_value_cents: market,
      margin_cents: margin,
      margin_pct: allIn ? round1((100.0 * margin) / allIn) : 0.0,
      margin_low_cents: market - fixed - repairs.high_cents,
      margin_high_cents: market - fixed - repairs.low_cents,
    };
  }

  const LotScore = { score, marketValue, buyerFee };
  if (typeof module !== "undefined" && module.exports) module.exports = LotScore;
  else root.LotScore = LotScore;
})(typeof globalThis !== "undefined" ? globalThis : this);
