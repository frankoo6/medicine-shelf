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
  // A real calendar date written as YYYY-MM-DD (rejects 2026-02-30, '', undefined).
  const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(parse(s)) === s;
  const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

  // Dates that follow from the last count. Does not depend on today.
  function plan(m) {
    const out = { runOut: null, orderBy: null, eligible: null, eligibleConfirmed: false, orderOn: null, callDoctor: null, tight: false, needsScript: needsScript(m) };
    if (!isScheduled(m)) return out;
    out.runOut = addDays(m.countedOn, Math.floor(m.onHand / m.perDay));
    out.orderBy = addDays(out.runOut, -(val(m, 'leadDays') + val(m, 'bufferDays')));
    if (m.confirmedRefill) { out.eligible = m.confirmedRefill; out.eligibleConfirmed = true; }
    else if (m.lastFillDate) {
      // Insurance counts the days' supply of the last fill. It is saved at pickup (amount picked up divided by
      // the daily amount at that time), so changing the schedule later doesn't rewrite it. Older lists without
      // it fall back to the amount picked up, then to a full fill of fillDays.
      const supplyDays = isCount(m.lastFillDaysSupply) && m.lastFillDaysSupply > 0 ? m.lastFillDaysSupply
        : isCount(m.lastFillQty) && m.lastFillQty > 0 ? m.lastFillQty / m.perDay : val(m, 'fillDays');
      out.eligible = addDays(m.lastFillDate, Math.ceil(supplyDays * val(m, 'eligiblePct') / 100));
    }
    if (out.eligible) out.tight = out.eligible > addDays(out.runOut, -val(m, 'leadDays'));
    out.orderOn = maxDate(out.orderBy, out.eligible);
    if (out.needsScript) out.callDoctor = addDays(out.orderOn, -SCRIPT_LEAD_DAYS);
    return out;
  }

  // What the card shows on day t.
  // action: the card's label: 'order' | 'script' | 'soon' | 'ok', the refill stage 'requested' | 'ready',
  //   or 'expired' | 'expiring'.
  // refillStage: 'requested' | 'ready' | undefined. Kept separately from action, so a refill already in
  //   progress still shows (and keeps its buttons) when expiry takes over the label.
  const EXPIRY_SOON_DAYS = 30;
  function live(m, t) {
    const out = baseLive(m, t);
    // Expiry (optional): an expired medicine is always urgent; one expiring within 30 days is 'soon'
    // unless something more urgent is already showing.
    if (isDateStr(m.expiresOn)) {
      out.expiresIn = diff(t, m.expiresOn);
      if (isScheduled(m) && out.p.runOut && out.expiresIn >= 0 && m.expiresOn < out.p.runOut) out.expiresBeforeRunOut = true;
    }
    const expired = out.expiresIn != null && out.expiresIn < 0;
    const expiring = out.expiresIn != null && !expired && out.expiresIn <= EXPIRY_SOON_DAYS;
    const stage = m.refill && m.refill.stage;
    if (stage === 'requested' || stage === 'ready') {
      // A refill in progress is not a refill in hand: it stays urgent when the supply is about to run out.
      const urgent = isScheduled(m) ? out.daysLeft <= val(m, 'leadDays') : m.onHand <= 0;
      out.refillStage = stage;
      out.stageUrgent = urgent; // urgent because of the supply itself (not because of expiry)
      out.status = urgent ? 'now' : 'soon';
      out.action = stage;
      out.stageSince = stage === 'ready' ? m.refill.readyOn : m.refill.requestedOn;
      out.stageDays = out.stageSince ? diff(out.stageSince, t) : 0;
    }
    if (expired) { out.status = 'now'; out.action = 'expired'; }
    else if (expiring && out.status === 'ok') { out.status = 'soon'; out.action = 'expiring'; }
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

  // What "Picked up a refill" suggests: one full fill at the daily amount, to 2 decimal places
  // (1.25 mL a day for 30 days suggests 37.5, not 38). Blank for as-needed medicines.
  const round2 = (n) => Math.round(n * 100) / 100;
  function suggestedPickup(m) {
    return isScheduled(m) ? round2(m.perDay * val(m, 'fillDays')) : '';
  }

  // The changes "Picked up a refill" makes: the count becomes the estimate on that day plus what was picked up.
  // countedOn moves (it's the starting point for the countdown), but verifiedOn does NOT: nobody physically
  // counted what was already left, so the "time for a recount" reminder keeps its date.
  function applyPickup(m, qty, d) {
    const out = {
      onHand: estimateOn(m, d) + qty, countedOn: d, verifiedOn: m.verifiedOn ?? m.countedOn,
      lastFillDate: d, lastFillQty: qty, lastFillDaysSupply: isScheduled(m) ? qty / m.perDay : null,
      confirmedRefill: null, refill: null,
    };
    if (typeof m.refillsLeft === 'number' && !m.controlled) out.refillsLeft = Math.max(0, m.refillsLeft - 1);
    return out;
  }

  // ---- Checking saved lists and backup files: the same rules for both ----

  // Fixes the optional fields of one medicine that are broken (a bad date, a negative number, a refill
  // marked ready with no date). Never changes the name, person, count or schedule. Returns a copy.
  function normalizeMed(m) {
    const c = { ...m, prn: m.prn === true };
    if (c.prn && c.perDay == null) c.perDay = 0;
    for (const k of ['lastFillDate', 'confirmedRefill', 'verifiedOn', 'expiresOn']) if (c[k] != null && !isDateStr(c[k])) c[k] = null;
    for (const k of ['minCount', 'lastFillQty', 'lastFillDaysSupply']) if (c[k] != null && !isCount(c[k])) c[k] = null;
    if (c.refillsLeft != null) c.refillsLeft = isCount(c.refillsLeft) ? Math.floor(c.refillsLeft) : null; // refills are whole numbers
    for (const k of ['leadDays', 'bufferDays']) if (c[k] != null && !isCount(c[k])) delete c[k];
    if (c.fillDays != null && !(isCount(c.fillDays) && c.fillDays > 0)) delete c.fillDays; // 0 days would mean "refill at once"
    if (c.eligiblePct != null && !(isCount(c.eligiblePct) && c.eligiblePct >= 50 && c.eligiblePct <= 100)) delete c.eligiblePct;
    if (c.refill) {
      const r = c.refill;
      if (!(r && ['requested', 'ready'].includes(r.stage) && isDateStr(r.requestedOn))) c.refill = null;
      else if (r.stage === 'ready' && !isDateStr(r.readyOn)) c.refill = { stage: 'requested', requestedOn: r.requestedOn }; // "ready" with no date: back to requested
    }
    return c;
  }

  // Why a medicine can't be shown as a normal card, or null if it can.
  // fatal: its count or schedule can't be worked out. A backup leaves it out; a list already on the phone
  //   keeps it and shows a "Needs fixing" card, so nothing is lost.
  // not fatal: an as-needed medicine with no reorder number. Kept, and shown as "Needs fixing" so one can be set.
  function medProblem(m, personIds) {
    if (!m || typeof m !== 'object') return { fatal: true, why: 'unreadable' };
    if (typeof m.name !== 'string' || !m.name.trim()) return { fatal: true, why: 'unnamed' };
    if (personIds && !personIds.has(m.personId)) return { fatal: true, why: 'no-person' };
    if (!isDateStr(m.countedOn) || !isCount(m.onHand)) return { fatal: true, why: 'count' };
    if (m.prn === true) {
      if (m.perDay != null && !isCount(m.perDay)) return { fatal: true, why: 'schedule' };
      if (!isCount(m.minCount)) return { fatal: false, why: 'no-reorder-number' };
    } else if (!(isCount(m.perDay) && m.perDay > 0)) return { fatal: true, why: 'schedule' };
    return null;
  }

  // Checks a whole list. Every person and medicine ends up with its own id (edit and refill buttons find
  // medicines by id, so two sharing one could change the wrong entry): a later duplicate person is left out
  // (their medicines stay with the first), and a medicine with a missing or repeated id gets a new one.
  // keepBroken: true for the list on this phone (damaged medicines are kept, to be fixed on screen);
  //             false for a backup file (they are left out and counted in `skipped`).
  const defaultId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function cleanList(data, newId = defaultId, { keepBroken = false } = {}) {
    const people = [], meds = [], personIds = new Set(), medIds = new Set();
    let skipped = 0, repaired = 0;
    for (const p of Array.isArray(data.people) ? data.people : []) {
      const hasId = p && typeof p.id === 'string' && p.id && !personIds.has(p.id);
      const named = hasId && typeof p.name === 'string' && p.name.trim();
      if (!hasId || (!named && !keepBroken)) { skipped++; continue; }
      personIds.add(p.id);
      people.push({ ...p, name: named ? p.name.trim().slice(0, 40) : 'Unnamed person', allergies: typeof p.allergies === 'string' ? p.allergies : '' });
    }
    for (const raw of Array.isArray(data.meds) ? data.meds : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { skipped++; continue; }
      const m = normalizeMed(raw);
      const problem = medProblem(m, personIds);
      if (problem && problem.fatal && !keepBroken) { skipped++; continue; }
      if (typeof m.id !== 'string' || !m.id || medIds.has(m.id)) { m.id = newId(); repaired++; }
      medIds.add(m.id);
      meds.push(m);
    }
    return { people, meds, skipped, repaired };
  }
  // A backup file: damaged entries are left out.
  const cleanBackupData = (data, newId) => cleanList(data, newId, { keepBroken: false });

  // Reads the list saved on this phone. Returns { ok: true, data } or { ok: false } when the text
  // can't be read as a Medicine Shelf list (so the caller can keep it instead of overwriting it).
  function parseSaved(raw) {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.people ?? []) && Array.isArray(d.meds ?? [])) return { ok: true, data: d };
    } catch (e) { /* fall through */ }
    return { ok: false };
  }

  // The list from before a Restore or Erase is kept for this many days so it can be brought back.
  const UNDO_DAYS = 7;
  function previousOffered(prev, t) {
    return !!(prev && isDateStr(prev.savedOn) && prev.data && Array.isArray(prev.data.people) && prev.data.people.length
      && diff(prev.savedOn, t) >= 0 && diff(prev.savedOn, t) <= UNDO_DAYS);
  }

  const api = { EXPIRY_SOON_DAYS, parseSaved, previousOffered, UNDO_DAYS, DEFAULTS, SCRIPT_LEAD_DAYS, pad, toStr, parse, addDays, diff, maxDate, val, isScheduled, needsScript, plan, live, estimateOn, applyPickup, suggestedPickup, round2, isDateStr, isCount, normalizeMed, medProblem, cleanList, cleanBackupData };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShelfMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
