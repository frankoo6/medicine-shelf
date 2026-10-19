// Tests for the supply and date math in shelf-math.js. No dependencies.
// Run from the repository folder:  TZ=America/New_York node tests/run.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const SM = require('../shelf-math.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message}`); }
}

test('basic 90-day fill: run-out, order-by and insurance estimate', () => {
  const m = { perDay: 2, onHand: 100, countedOn: '2026-09-30', lastFillDate: '2026-08-01', fillDays: 90 };
  const p = SM.plan(m);
  assert.equal(p.runOut, '2026-11-19');       // 100 / 2 = 50 days
  assert.equal(p.orderBy, '2026-11-09');      // minus 3 pharmacy + 7 buffer
  assert.equal(p.eligible, '2026-10-08');     // 90 days x 75% = 67.5 -> 68 days after Aug 1
  assert.equal(p.orderOn, '2026-11-09');
  assert.equal(p.tight, false);
});

test('insurance date after the safe order date is flagged and ordering is urgent', () => {
  const m = { perDay: 2, onHand: 20, countedOn: '2026-09-30', lastFillDate: '2026-09-20', fillDays: 90 };
  const p = SM.plan(m);
  assert.equal(p.runOut, '2026-10-10');
  assert.equal(p.eligible, '2026-11-27');
  assert.equal(p.tight, true);
  const l = SM.live(m, '2026-09-30');
  assert.equal(l.status, 'now');
  assert.equal(l.action, 'order');
});

test('controlled medicine: "contact prescriber" a week before the order date drives urgency', () => {
  const m = { perDay: 1, onHand: 20, countedOn: '2026-10-01', lastFillDate: '2026-09-20', fillDays: 30, eligiblePct: 80, controlled: true };
  const p = SM.plan(m);
  assert.equal(p.orderOn, '2026-10-14');      // insurance (Sep 20 + 24) is later than Oct 11
  assert.equal(p.callDoctor, '2026-10-07');
  assert.equal(SM.live(m, '2026-10-06').action, 'soon');
  assert.equal(SM.live(m, '2026-10-07').action, 'script');
  assert.equal(SM.live(m, '2026-10-07').status, 'now');
  assert.equal(SM.live(m, '2026-10-14').action, 'order');
});

test('no refills left counts as needing a new prescription', () => {
  const p = SM.plan({ perDay: 1, onHand: 30, countedOn: '2026-10-01', refillsLeft: 0 });
  assert.equal(p.needsScript, true);
  assert.ok(p.callDoctor);
});

test('as-needed controlled medicine: no made-up deadline, urgent when low', () => {
  const m = { prn: true, perDay: 0, onHand: 1, minCount: 1, countedOn: '2026-10-01', controlled: true };
  const p = SM.plan(m);
  assert.equal(p.callDoctor, null);
  const l = SM.live(m, '2026-10-19');
  assert.equal(l.status, 'now');
  assert.equal(l.action, 'script');
  assert.equal(SM.live({ ...m, onHand: 5 }, '2026-10-19').action, 'ok');
});

test('pharmacy-confirmed refill date replaces the estimate', () => {
  const m = { perDay: 2, onHand: 100, countedOn: '2026-09-30', lastFillDate: '2026-08-01', fillDays: 90, confirmedRefill: '2026-11-15' };
  const p = SM.plan(m);
  assert.equal(p.eligible, '2026-11-15');
  assert.equal(p.eligibleConfirmed, true);
  assert.equal(p.orderOn, '2026-11-15');
  assert.equal(p.tight, false);               // runs out Nov 19, pharmacy needs 3 days: Nov 16 is still after Nov 15
});

test('fractional counts are kept, not rounded down', () => {
  const m = { perDay: 1, onHand: 12.5, countedOn: '2026-10-01' };
  assert.equal(SM.estimateOn(m, '2026-10-03'), 10.5);
  assert.equal(SM.live(m, '2026-10-03').est, 10.5);
  assert.equal(SM.live(m, '2026-10-03').daysLeft, 10);
});

test('a date before the last count uses the count as is', () => {
  const m = { perDay: 2, onHand: 40, countedOn: '2026-10-10' };
  assert.equal(SM.estimateOn(m, '2026-10-05'), 40);
});

test('estimate never goes below zero', () => {
  const m = { perDay: 2, onHand: 4, countedOn: '2026-10-01' };
  assert.equal(SM.estimateOn(m, '2026-10-30'), 0);
});

test('daylight-saving changes do not shift any day', () => {
  // US clocks fall back Nov 1 2026 and spring forward Mar 8 2026.
  assert.equal(SM.diff('2026-10-31', '2026-11-02'), 2);
  assert.equal(SM.diff('2026-03-07', '2026-03-09'), 2);
  assert.equal(SM.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(SM.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(SM.plan({ perDay: 1, onHand: 10, countedOn: '2026-11-01' }).runOut, '2026-11-11');
});

test('month and year boundaries', () => {
  assert.equal(SM.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(SM.addDays('2028-02-28', 1), '2028-02-29');
});

test('refill requested: shown as in progress, but stays urgent when about to run out', () => {
  const m = { perDay: 1, onHand: 20, countedOn: '2026-10-01', refill: { stage: 'requested', requestedOn: '2026-10-10' } };
  const early = SM.live(m, '2026-10-12');      // 9 days left
  assert.equal(early.action, 'requested');
  assert.equal(early.status, 'soon');
  assert.equal(early.stageDays, 2);
  const late = SM.live(m, '2026-10-18');       // 3 days left = pharmacy lead time
  assert.equal(late.action, 'requested');
  assert.equal(late.status, 'now');
});

test('refill ready for pickup counts days since ready; count is unchanged until pickup', () => {
  const m = { perDay: 1, onHand: 20, countedOn: '2026-10-01', refill: { stage: 'ready', requestedOn: '2026-10-08', readyOn: '2026-10-09' } };
  const l = SM.live(m, '2026-10-12');
  assert.equal(l.action, 'ready');
  assert.equal(l.stageSince, '2026-10-09');
  assert.equal(l.stageDays, 3);
  assert.equal(l.est, 9);
});

test('as-needed refill in progress is urgent only when none are left', () => {
  const m = { prn: true, perDay: 0, onHand: 1, minCount: 2, countedOn: '2026-10-01', refill: { stage: 'requested', requestedOn: '2026-10-05' } };
  assert.equal(SM.live(m, '2026-10-06').status, 'soon');
  assert.equal(SM.live({ ...m, onHand: 0 }, '2026-10-06').status, 'now');
});

test('restore: damaged rows are skipped, broken optional fields are cleared', () => {
  const data = {
    people: [{ id: 'p1', name: 'Sam' }, { id: '', name: 'No id' }],
    meds: [
      { id: 'a', personId: 'p1', name: 'Good', perDay: 2, onHand: 30, countedOn: '2026-10-01', lastFillDate: 'yesterday', refillsLeft: -1, eligiblePct: 20 },
      { id: 'b', personId: 'p1', name: 'No count date', perDay: 1, onHand: 10 },
      { id: 'c', personId: 'p1', name: 'Bad date', perDay: 1, onHand: 10, countedOn: '2026-02-30' },
      { id: 'd', personId: 'p1', name: 'Text count', perDay: 1, onHand: '10', countedOn: '2026-10-01' },
      { id: 'e', personId: 'nobody', name: 'Orphan', perDay: 1, onHand: 10, countedOn: '2026-10-01' },
      { id: 'f', personId: 'p1', name: 'As needed', prn: true, onHand: 3, minCount: 1, countedOn: '2026-10-01' },
    ],
  };
  const c = SM.cleanBackupData(data);
  assert.deepEqual(c.people.map((p) => p.id), ['p1']);
  assert.deepEqual(c.meds.map((m) => m.id), ['a', 'f']);
  assert.equal(c.skipped, 5);
  assert.equal(c.meds[0].lastFillDate, null);
  assert.equal(c.meds[0].refillsLeft, null);
  assert.equal(c.meds[0].eligiblePct, undefined);
  assert.equal(SM.plan(c.meds[0]).runOut, '2026-10-16'); // still computes cleanly
});

test('date check rejects impossible and badly written dates', () => {
  assert.equal(SM.isDateStr('2026-10-19'), true);
  assert.equal(SM.isDateStr('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '10/19/2026', '', null, undefined, 20261019]) assert.equal(SM.isDateStr(bad), false, String(bad));
});

test('partial fill: insurance estimate uses the amount actually picked up', () => {
  const base = { perDay: 2, onHand: 60, countedOn: '2026-10-01', lastFillDate: '2026-10-01', fillDays: 90 };
  assert.equal(SM.plan(base).eligible, '2026-12-08');                       // full 90 days x 75% = 68 days
  assert.equal(SM.plan({ ...base, lastFillQty: 60 }).eligible, '2026-10-24'); // 60 tablets = 30 days x 75% = 23 days
  assert.equal(SM.plan({ ...base, lastFillQty: 180 }).eligible, '2026-12-08'); // a full fill gives the same answer
});

test('saved list that cannot be read is reported, not silently replaced', () => {
  assert.equal(SM.parseSaved('{"people":[],"meds":[]}').ok, true);
  assert.equal(SM.parseSaved('{"version":1}').ok, true);                 // empty but valid
  for (const bad of ['{"people":[', 'not json', 'null', '[]', '42', '{"people":"Sam"}', '{"meds":{}}']) {
    assert.equal(SM.parseSaved(bad).ok, false, bad);
  }
});

test('list from before a restore or erase is offered back for 7 days only', () => {
  const prev = { savedOn: '2026-10-19', reason: 'erase', data: { people: [{ id: 'p', name: 'Sam' }], meds: [] } };
  assert.equal(SM.previousOffered(prev, '2026-10-19'), true);
  assert.equal(SM.previousOffered(prev, '2026-10-26'), true);   // day 7
  assert.equal(SM.previousOffered(prev, '2026-10-27'), false);  // day 8
  assert.equal(SM.previousOffered({ ...prev, data: { people: [], meds: [] } }, '2026-10-20'), false); // nothing to bring back
  assert.equal(SM.previousOffered({ ...prev, savedOn: 'soon' }, '2026-10-20'), false);
  assert.equal(SM.previousOffered(null, '2026-10-20'), false);
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
