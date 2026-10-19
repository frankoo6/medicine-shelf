// Medicine Shelf date and supply math. No DOM, no storage: pure functions, so it can be tested on its own (tests/run.mjs).
// Dates are local calendar days as 'YYYY-MM-DD' strings. Times are pinned to noon so daylight-saving shifts never move a day.
(function (root) {
  'use strict';
  const DEFAULTS = { leadDays: 3, bufferDays: 7, eligiblePct: 75, fillDays: 30 };
  const SCRIPT_LEAD_DAYS = 7; // ask the prescriber this many days before the order date

  const pad = (n) => String(n).padStart(2, '0');
  const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
  const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000); // days from a to b
  const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const val = (m, k) => (m[k] ?? DEFAULTS[k]);
  const isScheduled = (m) => !m.prn && m.perDay > 0;
  const needsScript = (m) => !!m.controlled || m.refillsLeft === 0;

  // Dates that follow from the last count. Does not depend on today.
  function plan(m) {
    const out = { runOut: null, orderBy: null, eligible: null, eligibleConfirmed: false, orderOn: null, callDoctor: null, tight: false, needsScript: needsScript(m) };
    if (!isScheduled(m)) return out;
    out.runOut = addDays(m.countedOn, Math.floor(m.onHand / m.perDay));
    out.orderBy = addDays(out.runOut, -(val(m, 'leadDays') + val(m, 'bufferDays')));
    if (m.confirmedRefill) { out.eligible = m.confirmedRefill; out.eligibleConfirmed = true; }
    else if (m.lastFillDate) out.eligible = addDays(m.lastFillDate, Math.ceil(val(m, 'fillDays') * val(m, 'eligiblePct') / 100));
    if (out.eligible) out.tight = out.eligible > addDays(out.runOut, -val(m, 'leadDays'));
    out.orderOn = maxDate(out.orderBy, out.eligible);
    if (out.needsScript) out.callDoctor = addDays(out.orderOn, -SCRIPT_LEAD_DAYS);
    return out;
  }

  // What the card shows on day t.
  // action: 'order' | 'script' | 'soon' | 'ok', or the refill stage 'requested' | 'ready' while one is in progress.
  function live(m, t) {
    const out = baseLive(m, t);
    const stage = m.refill && m.refill.stage;
    if (stage === 'requested' || stage === 'ready') {
      // A refill in progress is not a refill in hand: it stays urgent when the supply is about to run out.
      const urgent = isScheduled(m) ? out.daysLeft <= val(m, 'leadDays') : m.onHand <= 0;
      out.status = urgent ? 'now' : 'soon';
      out.action = stage;
      out.stageSince = stage === 'ready' ? m.refill.readyOn : m.refill.requestedOn;
      out.stageDays = out.stageSince ? diff(out.stageSince, t) : 0;
    }
    return out;
  }
  function baseLive(m, t) {
    const p = plan(m);
    if (!isScheduled(m)) {
      const low = m.minCount != null && m.onHand <= m.minCount;
      const near = m.minCount != null && m.onHand <= m.minCount * 1.5;
      const action = low ? (p.needsScript ? 'script' : 'order') : near ? 'soon' : 'ok';
      return { est: m.onHand, daysLeft: null, status: low ? 'now' : near ? 'soon' : 'ok', action, p };
    }
    const est = Math.max(0, m.onHand - m.perDay * Math.max(0, diff(m.countedOn, t)));
    let status, action;
    if (p.orderOn <= t || (p.tight && p.orderBy <= t)) { status = 'now'; action = 'order'; }
    else if (p.needsScript && p.callDoctor <= t) { status = 'now'; action = 'script'; }
    else if (diff(t, p.orderOn) <= 14) { status = 'soon'; action = 'soon'; }
    else { status = 'ok'; action = 'ok'; }
    return { est, daysLeft: Math.floor(est / m.perDay), status, action, p };
  }

  // Estimated count on date d (used when recording a refill or recount on a past or present date).
  function estimateOn(m, d) {
    return isScheduled(m) ? Math.max(0, m.onHand - m.perDay * Math.max(0, diff(m.countedOn, d))) : m.onHand;
  }

  const api = { DEFAULTS, SCRIPT_LEAD_DAYS, pad, toStr, parse, addDays, diff, maxDate, val, isScheduled, needsScript, plan, live, estimateOn };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShelfMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
