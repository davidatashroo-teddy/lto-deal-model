'use strict';

// ─── County insurance (annual premium per $1M of home value) ─────────────────
const COUNTY_INS_PER_M = {
  "Contra Costa County, CA": 1700, "Alameda County, CA": 1700,
  "San Francisco County, CA": 1900, "San Mateo County, CA": 1700,
  "Santa Clara County, CA": 1700, "Marin County, CA": 2100,
  "Sonoma County, CA": 2400, "Napa County, CA": 2400,
  "Los Angeles County, CA": 1900, "Orange County, CA": 1700,
  "San Diego County, CA": 1700, "Riverside County, CA": 1900,
  "San Bernardino County, CA": 1900, "Sacramento County, CA": 1500,
  "Other / Manual entry": 1800
};

const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULTS = {
  total: 3100000, optionFee: 75000, monthlyRent: 15000, leaseMonths: 18,
  strikeAuto: true, signingDate: TODAY,
  sqft: 4316, county: 'Contra Costa County, CA', taxRate: 1.00, taxEsc: 2.00,
  product: '7-1arm', downPct: 20, closingPct: 2.00,
  closeRate: 5.40, todayRate: 6.40, holdYears: 30,
  refiYear: 7, refiRate: 4.90, refiCosts: 5000,
  insAuto: true, insEsc: 3.00,
  scALabel: 'What we offered', scASqft: 632,
  scBLabel: "What we'd counter at", scBSqft: 707,
  scCLabel: 'What seller wants', scCSqft: 788,
  sensDim: 'rate',
};

// ─── Pure math ────────────────────────────────────────────────────────────────

function mPI(loan, annRate, termMo) {
  if (loan <= 0) return 0;
  const r = annRate / 100 / 12;
  if (r < 1e-12) return loan / termMo;
  const x = Math.pow(1 + r, termMo);
  return loan * r * x / (x - 1);
}

function balAfter(loan, annRate, termMo, paid) {
  if (loan <= 0 || paid <= 0) return loan;
  const r = annRate / 100 / 12;
  if (r < 1e-12) return Math.max(0, loan - loan / termMo * paid);
  const x = Math.pow(1 + r, termMo);
  return loan * (x - Math.pow(1 + r, paid)) / (x - 1);
}

function geo(yr1, g, years) {
  if (yr1 <= 0 || years <= 0) return 0;
  if (Math.abs(g) < 1e-10) return yr1 * years;
  return yr1 * (Math.pow(1 + g, years) - 1) / g;
}

// Total P&I payments over holdYears; flatRefi is added once if ARM refi applies
function piTotal(loan, rate, inp, flatRefi) {
  const { product, refiYear, refiRate, holdYears } = inp;
  const hm = holdYears * 12;
  if (product === '30yr' || refiYear >= holdYears) return mPI(loan, rate, 360) * hm;
  const im = refiYear * 12;
  const init = mPI(loan, rate, 360) * im;
  const bal  = balAfter(loan, rate, 360, im);
  const refiTerm = (30 - refiYear) * 12;
  const refi = mPI(bal, refiRate, refiTerm) * (hm - im) + (flatRefi || 0);
  return init + refi;
}

function dealLifetime(inp) {
  const { optionFee, monthlyRent, leaseMonths, strike,
          downPct, closingPct, closeRate,
          taxRate, taxEsc, annIns, insEsc, holdYears, refiCosts } = inp;
  const dp   = downPct / 100 * strike;
  const loan = strike - dp;
  const pi   = piTotal(loan, closeRate, inp, refiCosts);
  const tax  = geo(strike * taxRate / 100, taxEsc / 100, holdYears);
  const ins  = geo(annIns, insEsc / 100, holdYears);
  return optionFee + monthlyRent * leaseMonths + dp + closingPct / 100 * strike + pi + tax + ins;
}

function convLifetime(price, inp) {
  const { downPct, closingPct, todayRate, taxRate, taxEsc,
          county, insEsc, holdYears, refiCosts } = inp;
  const dp    = downPct / 100 * price;
  const loan  = price - dp;
  const pi    = piTotal(loan, todayRate, inp, refiCosts);
  const tax   = geo(price * taxRate / 100, taxEsc / 100, holdYears);
  const ins   = geo(price * (COUNTY_INS_PER_M[county] || 1800) / 1e6, insEsc / 100, holdYears);
  return dp + closingPct / 100 * price + pi + tax + ins;
}

// k coefficient: convLifetime = price * k + flat (flat = refiCosts if ARM)
function calcK(inp) {
  const { downPct, closingPct, todayRate, taxRate, taxEsc,
          county, insEsc, holdYears } = inp;
  const loanPer = (100 - downPct) / 100;
  const piK  = piTotal(loanPer, todayRate, inp, 0);
  const taxK = geo(taxRate / 100, taxEsc / 100, holdYears);
  const insK = geo((COUNTY_INS_PER_M[county] || 1800) / 1e6, insEsc / 100, holdYears);
  return downPct / 100 + closingPct / 100 + piK + taxK + insK;
}

function solveBreakeven(dealCost, inp) {
  const k = calcK(inp);
  if (k <= 0) return 0;
  const { product, refiYear, holdYears, refiCosts } = inp;
  const flat = (product !== '30yr' && refiYear < holdYears) ? refiCosts : 0;
  return (dealCost - flat) / k;
}

function autoStrike(inp) {
  return Math.max(0, inp.total - inp.optionFee - inp.monthlyRent * inp.leaseMonths);
}

function autoIns(inp) {
  return (inp.strike || 0) * (COUNTY_INS_PER_M[inp.county] || 1800) / 1e6;
}

function addMonths(dateStr, n) {
  const d = new Date((dateStr || TODAY) + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Monthly P&I for display (initial period rate)
function initialPayment(price, rate, inp) {
  const loan = price * (1 - inp.downPct / 100);
  return mPI(loan, rate, 360);
}

// Monthly P&I post-refi for display
function refiPayment(price, rate, inp) {
  const loan = price * (1 - inp.downPct / 100);
  const im   = inp.refiYear * 12;
  const bal  = balAfter(loan, rate, 360, im);
  return mPI(bal, inp.refiRate, (30 - inp.refiYear) * 12);
}

// ─── Formatting ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function fmt$(n, d = 0) {
  if (!isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtM(n) {
  if (!isFinite(n)) return '—';
  return '$' + (n / 1e6).toFixed(2) + 'M';
}
function fmtPct(n) { return n.toFixed(2) + '%'; }
function fmtSqft(n) { return '$' + Math.round(n).toLocaleString() + '/sqft'; }
function fmtComma(n) {
  if (!isFinite(n)) return '';
  return Math.round(n).toLocaleString('en-US');
}
function stripCommas(s) {
  return (s || '').replace(/,/g, '').trim();
}

// Wire up focus/blur comma formatting on a text input
function commaInput(id) {
  const el = $(id); if (!el) return;
  el.addEventListener('focus', function() {
    this.value = stripCommas(this.value);
  });
  el.addEventListener('blur', function() {
    const n = parseFloat(stripCommas(this.value));
    if (isFinite(n)) this.value = fmtComma(n);
  });
}

// ─── Read inputs ──────────────────────────────────────────────────────────────
function readInputs() {
  const v = k => {
    const el = $(k);
    if (!el) return DEFAULTS[k];
    if (el.type === 'checkbox') return el.checked;
    if (el.tagName === 'SELECT') return el.value;
    const n = parseFloat(stripCommas(el.value));
    return isNaN(n) ? 0 : n;
  };
  const str = k => { const el = $(k); return el ? el.value : ''; };

  const strikeAuto = v('in-strike-auto');
  const total      = v('in-total');
  const optionFee  = v('in-option-fee');
  const monthlyRent = v('in-rent');
  const leaseMonths = v('in-lease-months');
  const sqft       = v('in-sqft');
  const county     = str('in-county');
  const taxRate    = v('in-tax-rate');
  const taxEsc     = v('in-tax-esc');
  const product    = str('in-product');
  const downPct    = v('in-down-pct');
  const closingPct = v('in-closing-pct');
  const closeRate  = v('in-close-rate');
  const todayRate  = v('in-today-rate');
  const holdYears  = v('in-hold-years');
  const refiYear   = v('in-refi-year');
  const refiRate   = v('in-refi-rate');
  const refiCosts  = v('in-refi-costs');
  const insAuto    = v('in-ins-auto');
  const insEsc     = v('in-ins-esc');
  const signingDate = str('in-signing-date');
  const scALabel   = str('in-sc-a-label');
  const scBLabel   = str('in-sc-b-label');
  const scCLabel   = str('in-sc-c-label');
  const scASqft    = v('in-sc-a-sqft');
  const scBSqft    = v('in-sc-b-sqft');
  const scCSqft    = v('in-sc-c-sqft');
  const sensDim    = str('in-sens-dim');

  const inp = {
    total, optionFee, monthlyRent, leaseMonths, strikeAuto,
    sqft, county, taxRate, taxEsc,
    product, downPct, closingPct, closeRate, todayRate, holdYears,
    refiYear, refiRate, refiCosts,
    insAuto, insEsc, signingDate,
    scALabel, scBLabel, scCLabel,
    scASqft, scBSqft, scCSqft,
    scAPrice: scASqft * sqft, scBPrice: scBSqft * sqft, scCPrice: scCSqft * sqft,
    sensDim,
  };

  inp.strike = strikeAuto ? autoStrike(inp) : v('in-strike');
  inp.annIns = insAuto    ? autoIns(inp)    : v('in-insurance');

  return inp;
}

// ─── Write results ────────────────────────────────────────────────────────────
function set(id, val) { const el = $(id); if (el) el.textContent = val; }
function setHtml(id, val) { const el = $(id); if (el) el.innerHTML = val; }

function savingsChip(delta, baselineLabel) {
  // delta = thisCost − baselineCost; positive = this option costs MORE than baseline
  if (!isFinite(delta)) return '';
  const lbl = baselineLabel || 'deal';
  if (delta > 250000)  return `<span class="savings-chip chip-red">Costs ${fmtM(delta)} more than ${lbl}</span>`;
  if (delta > 50000)   return `<span class="savings-chip chip-yellow">Costs ${fmtM(delta)} more than ${lbl}</span>`;
  if (delta >= -50000) return `<span class="savings-chip chip-gray">~Same as ${lbl}</span>`;
  return `<span class="savings-chip chip-green">Saves ${fmtM(-delta)} vs ${lbl}</span>`;
}

function writeCard(prefix, label, lifetime, compareCost, compareLabel, price, inp, isLease) {
  const { downPct, closingPct, sqft, product, refiYear, holdYears, annIns, county, strike } = inp;
  const rate    = isLease ? inp.closeRate : inp.todayRate;
  const loan    = price * (1 - downPct / 100);
  const initPI  = mPI(loan, rate, 360);
  const rPI     = (product !== '30yr' && refiYear < holdYears) ? refiPayment(price, rate, inp) : null;
  const taxMo   = price * inp.taxRate / 100 / 12;
  const insYear1 = isLease ? annIns : price * (COUNTY_INS_PER_M[county] || 1800) / 1e6;
  const insMo   = insYear1 / 12;
  const totalMo = initPI + taxMo + insMo;
  const delta   = lifetime - compareCost; // positive = this card costs MORE than baseline

  set(`${prefix}-label`, label);
  set(`${prefix}-lifetime`, fmtM(lifetime));
  set(`${prefix}-price`, isLease ? fmtM(inp.total) : fmtM(price));
  setHtml(`${prefix}-savings`, Math.abs(delta) < 100
    ? '<span class="savings-chip chip-gray">comparison baseline</span>'
    : savingsChip(delta, compareLabel));
  set(`${prefix}-loan`, fmt$(loan));
  set(`${prefix}-initPI`, fmt$(initPI));
  set(`${prefix}-refiPI`, rPI !== null ? fmt$(rPI) : 'n/a');
  set(`${prefix}-lease-mo`, isLease ? fmt$(inp.monthlyRent) : 'n/a');
  set(`${prefix}-housing-mo`, fmt$(totalMo));
  set(`${prefix}-tax-mo`, fmt$(taxMo));
  set(`${prefix}-ins-mo`, fmt$(insMo));
  set(`${prefix}-eff-sqft`, sqft > 0 ? fmtSqft(price / sqft) : '—');
  const totalInt = piTotal(loan, rate, inp, 0) - loan;
  set(`${prefix}-total-int`, fmt$(Math.max(0, totalInt)));
}

// ─── Main recalculate ─────────────────────────────────────────────────────────
function recalculate() {
  const inp = readInputs();

  // Update auto-computed fields in DOM
  if (inp.strikeAuto) {
    const el = $('in-strike');
    if (el && el !== document.activeElement) el.value = fmtComma(inp.strike);
  }
  if (inp.insAuto) {
    const el = $('in-insurance');
    if (el && el !== document.activeElement) el.value = fmtComma(inp.annIns);
  }
  // Close date
  const closeDate = addMonths(inp.signingDate, inp.leaseMonths);
  set('out-close-date', closeDate);
  const cdEl = $('in-close-date');
  if (cdEl) cdEl.value = closeDate;

  // Update scenario prices from sqft
  ['a','b','c'].forEach(s => {
    const p = $(`in-sc-${s}-price`);
    if (p && p !== document.activeElement) {
      const sqft = parseFloat(stripCommas($(`in-sc-${s}-sqft`).value)) || 0;
      p.value = fmtComma(Math.round(sqft * inp.sqft));
    }
  });

  // ARM visibility
  const isArm = inp.product !== '30yr';
  document.body.classList.toggle('is-arm', isArm);

  // Refi year default based on product
  if (inp.product === '5-1arm' && !$('in-refi-year')._touched) {
    $('in-refi-year').value = 5;
    inp.refiYear = 5;
  }

  // Lifetime costs
  const deal  = dealLifetime(inp);
  const costA = convLifetime(inp.scAPrice, inp);
  const costB = convLifetime(inp.scBPrice, inp);
  const costC = convLifetime(inp.scCPrice, inp);

  // Breakeven
  const be     = solveBreakeven(deal, inp);
  const beCost = convLifetime(be, inp);
  set('out-be-price', fmt$(be));
  set('out-be-sqft', inp.sqft > 0 ? fmtSqft(be / inp.sqft) : '—');

  // Comparison baseline
  const compareBase = $('in-compare-base')?.value || 'deal';
  const compareOpts = {
    deal: { cost: deal,   label: 'proposed deal' },
    sca:  { cost: costA,  label: (inp.scALabel || 'Scen A').toLowerCase() },
    scb:  { cost: costB,  label: (inp.scBLabel || 'Scen B').toLowerCase() },
    scc:  { cost: costC,  label: (inp.scCLabel || 'Scen C').toLowerCase() },
    be:   { cost: beCost, label: 'breakeven' },
  };
  const { cost: compareCost, label: compareLabel } = compareOpts[compareBase] || compareOpts.deal;

  // Write cards
  writeCard('deal', '39 Orinda View (Lease-to-Own)', deal, compareCost, compareLabel, inp.strike, inp, true);
  writeCard('sca',  inp.scALabel, costA, compareCost, compareLabel, inp.scAPrice, inp, false);
  writeCard('scb',  inp.scBLabel, costB, compareCost, compareLabel, inp.scBPrice, inp, false);
  writeCard('scc',  inp.scCLabel, costC, compareCost, compareLabel, inp.scCPrice, inp, false);

  // Bar chart (colors relative to selected comparison baseline)
  drawChart([
    { label: 'Proposed Deal', cost: deal },
    { label: inp.scALabel || 'Scenario A', cost: costA },
    { label: inp.scBLabel || 'Scenario B', cost: costB },
    { label: inp.scCLabel || 'Scenario C', cost: costC },
    { label: 'Breakeven', cost: beCost },
  ], compareCost);

  // Breakeven sensitivity table
  updateBeTable(inp, deal);

  // Sensitivity panel
  updateSensPanel(inp);

  // Sync Section B $/sqft displays when sqft or prices change
  ['fair-value', 'seller-ask'].forEach(pfx => {
    const sqftEl = $(`in-${pfx}-sqft`);
    if (sqftEl && sqftEl !== document.activeElement) {
      const price = parseFloat(stripCommas($(`in-${pfx}`)?.value || '0')) || 0;
      sqftEl.value = inp.sqft > 0 ? Math.round(price / inp.sqft) : 0;
    }
  });

  // Section B
  updateSectionB();
}

// ─── Bar chart (SVG) — generic ───────────────────────────────────────────────
function drawBarChart(svgId, scenarios, baselineCost) {
  const svg = $(svgId);
  if (!svg) return;

  const W = 700, ROW = 44, PAD_L = 175, PAD_R = 90, PAD_T = 20, PAD_B = 30;
  const h = PAD_T + scenarios.length * ROW + PAD_B;
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  svg.setAttribute('height', h);

  const maxCost = Math.max(...scenarios.map(s => s.cost)) * 1.05;
  const barW = W - PAD_L - PAD_R;

  function barColor(s) {
    if (s.isBaseline) return '#64748b';
    const delta = s.cost - baselineCost; // positive = this bar costs MORE than baseline
    if (delta > 250000)  return '#dc2626'; // red: much more expensive
    if (delta > 50000)   return '#d97706'; // amber: somewhat more expensive
    if (delta >= -50000) return '#94a3b8'; // gray: ~equivalent
    return '#16a34a';                       // green: cheaper than baseline
  }

  let out = `<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${h - PAD_B}" class="bar-axis"/>`;

  scenarios.forEach((s, i) => {
    const y   = PAD_T + i * ROW;
    const bw  = Math.max(2, (s.cost / maxCost) * barW);
    const mid = y + ROW * 0.5;
    out += `
      <rect x="${PAD_L}" y="${y + 6}" width="${bw}" height="${ROW - 14}"
            rx="4" fill="${barColor(s)}" opacity="${s.isBaseline ? 0.5 : 0.85}"/>
      <text x="${PAD_L - 8}" y="${mid + 4}" class="bar-label" text-anchor="end"
            font-weight="${s.isCurrent || s.isBaseline ? 700 : 400}">${s.label}</text>
      <text x="${PAD_L + bw + 6}" y="${mid + 4}" class="bar-value">${fmtM(s.cost)}</text>`;
  });

  svg.innerHTML = out;
}

function drawChart(scenarios, dealCost) {
  drawBarChart('bar-chart', scenarios, dealCost);
}

// ─── Breakeven sensitivity table ──────────────────────────────────────────────
let beRows = []; // { sqft: number } — user-defined rows

function initBeRows(inp) {
  const be = solveBreakeven(dealLifetime(inp), inp);
  beRows = [
    { sqft: Math.round(be / inp.sqft), isBreakeven: true },
    { sqft: 700 }, { sqft: 720 }, { sqft: 750 }, { sqft: 780 },
  ];
}

function renderBeTable(inp, deal) {
  const tbody = $('be-table-body');
  if (!tbody) return;
  let html = '';
  beRows.forEach((row, i) => {
    const price   = row.sqft * inp.sqft;
    const cost    = convLifetime(price, inp);
    const savings = cost - deal;
    const cls     = row.isBreakeven ? 'class="breakeven-row"' : '';
    const savTxt  = row.isBreakeven ? '<em>Breakeven</em>'
      : (savings > 0 ? `+${fmtM(savings)}` : fmtM(savings));
    html += `<tr ${cls}>
      <td><input type="number" value="${row.sqft}" style="width:80px"
           onchange="beRowChange(${i}, this.value)"></td>
      <td>${fmt$(price)}</td>
      <td>${fmtM(cost)}</td>
      <td style="color:${savings < 0 ? 'var(--red)' : savings > 0 ? 'var(--green)' : 'inherit'}">${savTxt}</td>
      <td class="del-cell"><button class="del-btn" onclick="delBeRow(${i})">✕</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

function updateBeTable(inp, deal) {
  if (beRows.length === 0) initBeRows(inp);
  renderBeTable(inp, deal);
}

window.beRowChange = (i, val) => {
  beRows[i].sqft = parseFloat(val) || 0;
  recalculate();
};

window.delBeRow = (i) => {
  beRows.splice(i, 1);
  recalculate();
};

window.addBeRow = () => {
  const val = parseFloat($('be-add-sqft').value) || 750;
  beRows.push({ sqft: val });
  recalculate();
};

// ─── Sensitivity panel ────────────────────────────────────────────────────────
const SENS_DIMS = {
  rate:       { label: 'Mortgage rate at close', vals: v => [v-1, v-.5, v, v+.5, v+1].map(x => ({lbl: fmtPct(x), mod: {closeRate: x}})), base: inp => inp.closeRate },
  hold:       { label: 'Hold period (years)',    vals: () => [5,7,10,15,30].map(x => ({lbl: x+' yr', mod: {holdYears: x}})), base: () => null },
  lease:      { label: 'Lease length (months)',  vals: () => [12,14,18,24,26].map(x => ({lbl: x+' mo', mod: {leaseMonths: x}})), base: () => null },
  taxesc:     { label: 'Property tax escalation',vals: () => [1,2,3].map(x => ({lbl: fmtPct(x), mod: {taxEsc: x}})), base: () => null },
  refirate:   { label: 'Refinance rate (ARM)',   vals: v => [v-1, v-.5, v, v+.5].map(x => ({lbl: fmtPct(x), mod: {refiRate: x}})), base: inp => inp.refiRate },
  refiyear:   { label: 'Refinance year (ARM)',   vals: () => [{lbl:'Yr 5',mod:{refiYear:5}},{lbl:'Yr 7',mod:{refiYear:7}},{lbl:'Yr 10',mod:{refiYear:10}},{lbl:'Never',mod:{refiYear:999}}], base: () => null },
};

function updateSensPanel(inp) {
  const dim = SENS_DIMS[inp.sensDim];
  if (!dim) return;
  const base = dim.base(inp);
  const rows = dim.vals(base);
  const scBPrice = inp.scBPrice;

  let html = `<thead><tr><th>${dim.label}</th><th>Deal cost</th><th>Breakeven price</th><th>Savings vs Scen B</th></tr></thead><tbody>`;
  rows.forEach(row => {
    const modInp = Object.assign({}, inp, row.mod);
    // Recompute derived values if needed
    if (row.mod.leaseMonths !== undefined || row.mod.closeRate !== undefined) {
      if (modInp.strikeAuto) modInp.strike = autoStrike(modInp);
      if (modInp.insAuto)    modInp.annIns  = autoIns(modInp);
    }
    const dc  = dealLifetime(modInp);
    const be  = solveBreakeven(dc, modInp);
    const cB  = convLifetime(scBPrice, modInp);
    const sav = cB - dc;
    html += `<tr>
      <td>${row.lbl}</td>
      <td>${fmtM(dc)}</td>
      <td>${fmt$(be)} (${modInp.sqft > 0 ? fmtSqft(be / modInp.sqft) : '—'})</td>
      <td style="color:${sav < 0 ? 'var(--red)' : 'var(--green)'}">${sav >= 0 ? '+' : ''}${fmtM(sav)}</td>
    </tr>`;
  });
  html += '</tbody>';
  setHtml('sens-table', html);
}

// ─── URL state ────────────────────────────────────────────────────────────────
function encodeState() {
  const inp = readInputs();
  const p = new URLSearchParams({
    total: inp.total, fee: inp.optionFee, rent: inp.monthlyRent,
    mo: inp.leaseMonths, sdate: inp.signingDate,
    sqft: inp.sqft, county: inp.county,
    tax: inp.taxRate, taxesc: inp.taxEsc,
    prod: inp.product, down: inp.downPct, close: inp.closingPct,
    crate: inp.closeRate, trate: inp.todayRate, hold: inp.holdYears,
    ryr: inp.refiYear, rrate: inp.refiRate, rcost: inp.refiCosts,
    insesc: inp.insEsc,
    salab: inp.scALabel, sblab: inp.scBLabel, sclab: inp.scCLabel,
    sasqft: inp.scASqft, sbsqft: inp.scBSqft, scsqft: inp.scCSqft,
    sdim: inp.sensDim,
    sauto: inp.strikeAuto ? 1 : 0,
    iauto: inp.insAuto ? 1 : 0,
  });
  if (!inp.strikeAuto) p.set('strike', inp.strike);
  if (!inp.insAuto)    p.set('ins', inp.annIns);
  return location.origin + location.pathname + '?' + p.toString();
}

function decodeState() {
  const p = new URLSearchParams(location.search);
  if (!p.has('total')) return;
  const set = (id, key, isNum) => {
    const el = $(id); if (!el || !p.has(key)) return;
    el.value = isNum ? parseFloat(p.get(key)) : p.get(key);
  };
  const setChk = (id, key) => {
    const el = $(id); if (!el || !p.has(key)) return;
    el.checked = p.get(key) === '1';
    el.dispatchEvent(new Event('change'));
  };
  set('in-total', 'total', 1); set('in-option-fee', 'fee', 1);
  set('in-rent', 'rent', 1); set('in-lease-months', 'mo', 1);
  set('in-signing-date', 'sdate'); set('in-sqft', 'sqft', 1);
  set('in-county', 'county'); set('in-tax-rate', 'tax', 1);
  set('in-tax-esc', 'taxesc', 1); set('in-product', 'prod');
  set('in-down-pct', 'down', 1); set('in-closing-pct', 'close', 1);
  set('in-close-rate', 'crate', 1); set('in-today-rate', 'trate', 1);
  set('in-hold-years', 'hold', 1); set('in-refi-year', 'ryr', 1);
  set('in-refi-rate', 'rrate', 1); set('in-refi-costs', 'rcost', 1);
  set('in-ins-esc', 'insesc', 1);
  set('in-sc-a-label', 'salab'); set('in-sc-b-label', 'sblab'); set('in-sc-c-label', 'sclab');
  set('in-sc-a-sqft', 'sasqft', 1); set('in-sc-b-sqft', 'sbsqft', 1); set('in-sc-c-sqft', 'scsqft', 1);
  set('in-sens-dim', 'sdim');
  setChk('in-strike-auto', 'sauto'); setChk('in-ins-auto', 'iauto');
  if (p.has('strike')) { set('in-strike', 'strike', 1); }
  if (p.has('ins'))    { set('in-insurance', 'ins', 1); }
}

// ─── Scenario sqft ↔ price bidirectional sync ─────────────────────────────────
function syncScen(s, fromSqft) {
  const sqft   = parseFloat(stripCommas($('in-sqft').value)) || 1;
  const sqftEl  = $(`in-sc-${s}-sqft`);
  const priceEl = $(`in-sc-${s}-price`);
  if (fromSqft) {
    priceEl.value = fmtComma(Math.round((parseFloat(stripCommas(sqftEl.value)) || 0) * sqft));
  } else {
    sqftEl.value = ((parseFloat(stripCommas(priceEl.value)) || 0) / sqft).toFixed(0);
  }
}

// ─── Section B $/sqft ↔ total bidirectional sync ─────────────────────────────
function syncBSqft(pfx, fromSqft) {
  const houseSqft = parseFloat(stripCommas($('in-sqft').value)) || 1;
  const sqftEl  = $(`in-${pfx}-sqft`);
  const priceEl = $(`in-${pfx}`);
  if (!sqftEl || !priceEl) return;
  if (fromSqft) {
    priceEl.value = fmtComma(Math.round((parseFloat(sqftEl.value) || 0) * houseSqft));
  } else {
    sqftEl.value = Math.round((parseFloat(stripCommas(priceEl.value)) || 0) / houseSqft);
  }
}

// ─── Section B: Deal Structure Comparison ────────────────────────────────────

function solveStrikeForTotal(targetTotal, leaseMonths, inp) {
  return targetTotal - inp.optionFee - inp.monthlyRent * leaseMonths;
}

function dealLifetimeCustom(leaseMonths, strike, inp) {
  const m = Object.assign({}, inp, { leaseMonths, strike });
  if (m.insAuto) m.annIns = autoIns(m);
  return dealLifetime(m);
}

function structRow(label, sublabel, leaseMonths, strike, totalToSeller, inp, baselineCost, flags) {
  const m       = Object.assign({}, inp, { leaseMonths, strike });
  if (m.insAuto) m.annIns = autoIns(m);
  const cost    = flags.isBaseline ? baselineCost : dealLifetimeCustom(leaseMonths, strike, inp);
  const loan    = strike * (1 - inp.downPct / 100);
  const rate    = flags.isBaseline ? inp.todayRate : inp.closeRate;
  const initPI  = mPI(loan, rate, 360);
  const refiPI  = (!flags.isBaseline && inp.product !== '30yr' && inp.refiYear < inp.holdYears)
    ? refiPayment(strike, rate, inp) : null;
  const closeDate = addMonths(inp.signingDate, leaseMonths);
  const savings   = baselineCost - cost;
  return { label, sublabel, leaseMonths, strike, totalToSeller, cost, loan, initPI, refiPI, closeDate, savings, ...flags };
}

function renderStructRow(row) {
  const { label, sublabel, totalToSeller, strike, closeDate, cost, loan, initPI, refiPI, savings, isBaseline, isCurrent } = row;
  let savHtml;
  if (isBaseline) {
    savHtml = '<span style="color:var(--muted)">baseline</span>';
  } else if (savings > 250000) {
    savHtml = `<span style="color:var(--green);font-weight:700">saves ${fmtM(savings)}</span>`;
  } else if (savings > 50000) {
    savHtml = `<span style="color:var(--amber);font-weight:700">saves ${fmtM(savings)}</span>`;
  } else if (savings >= -50000) {
    savHtml = `<span style="color:var(--muted);font-weight:600">~even</span>`;
  } else {
    savHtml = `<span style="color:var(--red);font-weight:700">costs ${fmtM(-savings)} more</span>`;
  }
  const piDisplay = refiPI ? `${fmt$(initPI)} → ${fmt$(refiPI)}` : fmt$(initPI);
  const cls = isBaseline ? 'baseline-row' : isCurrent ? 'current-offer-row' : '';
  return `<tr class="${cls}">
    <td><strong>${label}</strong><br><span style="font-size:.72rem;color:var(--muted)">${sublabel}</span></td>
    <td>${fmt$(totalToSeller)}</td>
    <td>${isBaseline ? '—' : fmt$(strike)}</td>
    <td>${closeDate}</td>
    <td><strong>${fmtM(cost)}</strong></td>
    <td>${savHtml}</td>
    <td>${fmt$(loan)}</td>
    <td>${piDisplay}</td>
  </tr>`;
}

function updateSectionB() {
  const tbody = $('struct-tbody');
  if (!tbody) return;

  const inp       = readInputs();
  const fairValue = parseFloat(stripCommas($('in-fair-value')?.value || '3050000')) || 3050000;
  const sellerAsk = parseFloat(stripCommas($('in-seller-ask')?.value || '3400000')) || 3400000;

  // Baseline: buy comparable at fair value today
  const baselineConv  = inp => convLifetime(fairValue, inp);
  const baselineCost  = baselineConv(inp);
  const baselineLoan  = fairValue * (1 - inp.downPct / 100);

  // Fixed strike from current deal structure
  const fixedStrike = inp.strike;

  // Part 1: fixed strike, varying lease
  const p1 = [12, 18, 24].map(mo => {
    const total = inp.optionFee + mo * inp.monthlyRent + fixedStrike;
    return structRow(
      `${mo}mo lease`,
      `${fmt$(fixedStrike)} strike · closes ${addMonths(inp.signingDate, mo)}`,
      mo, fixedStrike, total, inp, baselineCost,
      { isCurrent: mo === inp.leaseMonths }
    );
  });

  // Part 2: fixed lease (18 & 24mo), solve strike for two targets
  const p2 = [];
  [18, 24].forEach(mo => {
    [inp.total, sellerAsk].forEach(target => {
      const strike = solveStrikeForTotal(target, mo, inp);
      if (strike < 0) return;
      const tLabel = target === inp.total ? `${fmt$(target)} proposed` : `${fmt$(target)} seller's ask`;
      p2.push(structRow(
        `${mo}mo · strike to hit ${tLabel}`,
        `${fmt$(strike)} strike · closes ${addMonths(inp.signingDate, mo)}`,
        mo, strike, target, inp, baselineCost,
        { isCurrent: mo === inp.leaseMonths && Math.round(strike) === Math.round(fixedStrike) }
      ));
    });
  });

  // Baseline row
  const blRow = structRow(
    `Buy comparable ${fmt$(fairValue)} now`,
    'Conventional purchase · market alternative',
    0, fairValue, fairValue, inp, baselineCost,
    { isBaseline: true }
  );
  // Override cost with actual convLifetime
  blRow.cost    = baselineCost;
  blRow.loan    = baselineLoan;
  blRow.initPI  = mPI(baselineLoan, inp.todayRate, 360);
  blRow.refiPI  = null;
  blRow.savings = 0;

  // Render table
  const divider = (txt, cols) =>
    `<tr class="divider-row"><td colspan="${cols}">${txt}</td></tr>`;

  tbody.innerHTML =
    divider(`Part 1 — Fixed strike (${fmt$(fixedStrike)}), lease length as the lever`, 8) +
    p1.map(renderStructRow).join('') +
    divider('Part 2 — Fixed lease (18mo or 24mo), strike as the lever', 8) +
    p2.map(renderStructRow).join('') +
    renderStructRow(blRow);

  // Bar chart B
  const chartRows = [
    ...p1.map(r => ({ label: `${r.leaseMonths}mo / ${fmtM(r.totalToSeller)}`, cost: r.cost, isCurrent: r.isCurrent })),
    ...p2.map(r => ({ label: `${r.leaseMonths}mo · ${fmtM(r.totalToSeller)}`, cost: r.cost })),
    { label: `Buy $${(fairValue/1e6).toFixed(2)}M now`, cost: baselineCost, isBaseline: true },
  ];
  drawBarChart('bar-chart-b', chartRows, baselineCost);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Set defaults
  const setDef = (id, key) => {
    const el = $(id); if (!el) return;
    if (el.type === 'checkbox') el.checked = DEFAULTS[key];
    else el.value = DEFAULTS[key];
  };
  Object.keys(DEFAULTS).forEach(k => {
    const id = 'in-' + k.replace(/([A-Z])/g, m => '-' + m.toLowerCase())
                         .replace(/^in-/, '');
    setDef('in-' + k.replace(/([A-Z])/g, m => '-' + m.toLowerCase()), k);
  });

  // Simpler explicit wiring
  const fields = [
    'in-total','in-option-fee','in-rent','in-lease-months','in-strike',
    'in-sqft','in-county','in-tax-rate','in-tax-esc',
    'in-product','in-down-pct','in-closing-pct','in-close-rate','in-today-rate','in-hold-years',
    'in-refi-year','in-refi-rate','in-refi-costs',
    'in-insurance','in-ins-esc','in-signing-date',
    'in-sc-a-label','in-sc-b-label','in-sc-c-label',
    'in-sens-dim',
  ];
  fields.forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('input', recalculate);
    el.addEventListener('change', recalculate);
  });

  // Bidirectional sqft/price for scenarios
  ['a','b','c'].forEach(s => {
    $(`in-sc-${s}-sqft`).addEventListener('input', () => { syncScen(s, true); recalculate(); });
    $(`in-sc-${s}-price`).addEventListener('input', () => { syncScen(s, false); recalculate(); });
  });

  // Override toggles
  $('in-strike-auto').addEventListener('change', function() {
    const el = $('in-strike');
    el.readOnly = this.checked;
    el.classList.toggle('auto-computed', this.checked);
    recalculate();
  });
  $('in-ins-auto').addEventListener('change', function() {
    const el = $('in-insurance');
    el.readOnly = this.checked;
    el.classList.toggle('auto-computed', this.checked);
    recalculate();
  });

  // Section B inputs — bidirectional total ↔ $/sqft sync
  const _fvEl  = $('in-fair-value');
  const _saEl  = $('in-seller-ask');
  const _fvSEl = $('in-fair-value-sqft');
  const _saSEl = $('in-seller-ask-sqft');
  if (_fvEl) {
    _fvEl.addEventListener('input', () => { syncBSqft('fair-value', false); recalculate(); });
    _fvEl.addEventListener('change', recalculate);
  }
  if (_saEl) {
    _saEl.addEventListener('input', () => { syncBSqft('seller-ask', false); recalculate(); });
    _saEl.addEventListener('change', recalculate);
  }
  if (_fvSEl) _fvSEl.addEventListener('input', () => { syncBSqft('fair-value', true); recalculate(); });
  if (_saSEl) _saSEl.addEventListener('input', () => { syncBSqft('seller-ask', true); recalculate(); });
  commaInput('in-fair-value');
  commaInput('in-seller-ask');

  // Compare-vs selector
  const _cmpEl = $('in-compare-base');
  if (_cmpEl) _cmpEl.addEventListener('change', recalculate);

  // Wire comma formatting on dollar-amount text inputs
  ['in-total','in-option-fee','in-rent','in-sqft','in-refi-costs',
   'in-strike','in-insurance',
   'in-sc-a-price','in-sc-b-price','in-sc-c-price'].forEach(commaInput);

  // Set initial comma-formatted display values
  [['in-total', 3100000], ['in-option-fee', 75000], ['in-rent', 15000],
   ['in-sqft', 4316], ['in-refi-costs', 5000]].forEach(([id, val]) => {
    const el = $(id); if (el) el.value = fmtComma(val);
  });

  // Initialize Section B $/sqft fields
  const _defSqft = 4316;
  if (_fvSEl) _fvSEl.value = Math.round(3050000 / _defSqft);
  if (_saSEl) _saSEl.value = Math.round(3400000 / _defSqft);

  // Track if refi-year was manually touched
  $('in-refi-year').addEventListener('input', function() { this._touched = true; });

  // Product change: auto-set refi year default
  $('in-product').addEventListener('change', function() {
    const ry = $('in-refi-year');
    if (!ry._touched) {
      ry.value = this.value === '5-1arm' ? 5 : 7;
    }
    recalculate();
  });

  // URL buttons
  $('btn-copy-url').addEventListener('click', () => {
    navigator.clipboard.writeText(encodeState()).then(() => {
      const btn = $('btn-copy-url');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy scenario URL'; }, 2000);
    });
  });
  $('btn-reset').addEventListener('click', () => {
    beRows = [];
    location.href = location.pathname;
  });

  // Decode URL if params present
  decodeState();

  // Set initial auto-state classes
  $('in-strike').readOnly = $('in-strike-auto').checked;
  $('in-strike').classList.toggle('auto-computed', $('in-strike-auto').checked);
  $('in-insurance').readOnly = $('in-ins-auto').checked;
  $('in-insurance').classList.toggle('auto-computed', $('in-ins-auto').checked);

  recalculate();
}

document.addEventListener('DOMContentLoaded', init);
