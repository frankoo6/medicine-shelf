// Tests for the supply and date math in shelf-math.js, and for the flyer QR link. No dependencies.
// Run from the repository folder:  TZ=America/New_York node tests/run.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const SM = require('../shelf-math.js');
const flyer = require('../flyer.js');

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

test('expiry: expired is urgent, within 30 days is soon, before run-out is flagged', () => {
  const prn = { prn: true, perDay: 0, onHand: 2, minCount: 1, countedOn: '2026-10-01' };
  assert.equal(SM.live(prn, '2026-10-19').action, 'ok');
  assert.equal(SM.live({ ...prn, expiresOn: '2026-12-31' }, '2026-10-19').action, 'ok');        // 73 days away
  const soon = SM.live({ ...prn, expiresOn: '2026-11-10' }, '2026-10-19');                        // 22 days away
  assert.equal(soon.action, 'expiring'); assert.equal(soon.status, 'soon'); assert.equal(soon.expiresIn, 22);
  const gone = SM.live({ ...prn, expiresOn: '2026-10-18' }, '2026-10-19');
  assert.equal(gone.action, 'expired'); assert.equal(gone.status, 'now');
  // a more urgent reason keeps its own label when the expiry is only "soon"
  assert.equal(SM.live({ ...prn, onHand: 1, expiresOn: '2026-11-10' }, '2026-10-19').action, 'order');
  // scheduled medicine that would expire before it is used up
  const daily = { perDay: 1, onHand: 90, countedOn: '2026-10-01', expiresOn: '2026-11-15' };
  assert.equal(SM.live(daily, '2026-10-19').expiresBeforeRunOut, true);
  // a bad date from a backup is ignored
  assert.equal(SM.live({ ...prn, expiresOn: 'soon' }, '2026-10-19').action, 'ok');
});

test('expired medicine keeps its refill in progress', () => {
  const m = { prn: true, perDay: 0, onHand: 2, minCount: 1, countedOn: '2026-10-01', expiresOn: '2026-10-10',
    refill: { stage: 'requested', requestedOn: '2026-10-15' } };
  const l = SM.live(m, '2026-10-19');
  assert.equal(l.action, 'expired');          // expiry sets the label...
  assert.equal(l.status, 'now');
  assert.equal(l.refillStage, 'requested');   // ...but the refill progress is still there
  assert.equal(l.stageDays, 4);
  assert.equal(l.stageUrgent, false);         // urgent because expired, not because the supply is out
  const ready = SM.live({ ...m, refill: { stage: 'ready', requestedOn: '2026-10-15', readyOn: '2026-10-17' } }, '2026-10-19');
  assert.equal(ready.refillStage, 'ready'); assert.equal(ready.stageSince, '2026-10-17');
});

test('picking up a refill is not a recount', () => {
  const m = { perDay: 2, onHand: 20, countedOn: '2026-10-01', verifiedOn: '2026-06-01', refillsLeft: 2, refill: { stage: 'ready', requestedOn: '2026-10-05' } };
  const r = SM.applyPickup(m, 180, '2026-10-06');
  assert.equal(r.onHand, 190);                // 20 - 2x5 days + 180
  assert.equal(r.countedOn, '2026-10-06');    // the countdown restarts from the pickup...
  assert.equal(r.verifiedOn, '2026-06-01');   // ...but the last real count is unchanged
  assert.equal(r.refillsLeft, 1);
  assert.equal(r.refill, null);
  // an older list with no verifiedOn keeps its count date as the last real count
  assert.equal(SM.applyPickup({ perDay: 1, onHand: 5, countedOn: '2026-09-01' }, 30, '2026-09-03').verifiedOn, '2026-09-01');
  // controlled medicines don't use up refills
  assert.equal(SM.applyPickup({ ...m, controlled: true }, 30, '2026-10-06').refillsLeft, undefined);
});

test('decimal amounts are not rounded to whole numbers or to one place', () => {
  assert.equal(SM.suggestedPickup({ perDay: 1.25, fillDays: 30 }), 37.5);
  assert.equal(SM.suggestedPickup({ perDay: 2, fillDays: 90 }), 180);
  assert.equal(SM.suggestedPickup({ perDay: 0.33, fillDays: 30 }), 9.9);
  assert.equal(SM.suggestedPickup({ prn: true, perDay: 0 }), '');
  assert.equal(SM.round2(0.25), 0.25);          // shown as 0.25, not 0.3
  assert.equal(SM.round2(100.5 - 2.3 * 3), 93.6); // no floating-point tails
});

test('the last fill keeps its days\' supply after the schedule changes', () => {
  const m = { perDay: 2, onHand: 0, countedOn: '2026-10-01', fillDays: 90 };
  const picked = { ...m, ...SM.applyPickup(m, 60, '2026-10-01') };   // 60 tablets at 2 a day = 30 days
  assert.equal(picked.lastFillDaysSupply, 30);
  assert.equal(SM.plan(picked).eligible, '2026-10-24');               // 30 x 75% = 23 days
  const halved = { ...picked, perDay: 1 };                             // later: 1 a day
  assert.equal(SM.plan(halved).eligible, '2026-10-24');               // still 30 days, not 60
  // an older list with only the amount still works
  assert.equal(SM.plan({ ...m, lastFillDate: '2026-10-01', lastFillQty: 60 }).eligible, '2026-10-24');
});

test('checks: duplicate ids, ready with no date, fractional refills, zero fill days', () => {
  let n = 0; const newId = () => `new${++n}`;
  const data = {
    people: [{ id: 'p1', name: 'Sam' }, { id: 'p1', name: 'Sam again' }],
    meds: [
      { id: 'a', personId: 'p1', name: 'One', perDay: 1, onHand: 30, countedOn: '2026-10-01', refillsLeft: 2.7, fillDays: 0,
        refill: { stage: 'ready', requestedOn: '2026-10-02' } },
      { id: 'a', personId: 'p1', name: 'Two', perDay: 1, onHand: 30, countedOn: '2026-10-01' },
      { personId: 'p1', name: 'No id', perDay: 1, onHand: 30, countedOn: '2026-10-01' },
    ],
  };
  const c = SM.cleanBackupData(data, newId);
  assert.deepEqual(c.people.map((p) => p.name), ['Sam']);        // the repeated person is left out
  assert.equal(c.skipped, 1);
  assert.deepEqual(c.meds.map((m) => m.id), ['a', 'new1', 'new2']); // repeated and missing ids get new ones
  assert.equal(c.repaired, 2);
  assert.equal(c.meds[0].refillsLeft, 2);                         // refills are whole numbers
  assert.equal(c.meds[0].fillDays, undefined);                    // 0 days dropped, default used
  assert.equal(SM.plan(c.meds[0]).runOut, '2026-10-31');
  assert.deepEqual(c.meds[0].refill, { stage: 'requested', requestedOn: '2026-10-02' }); // "ready" with no date
});

test('checks: as-needed with no reorder number is kept but flagged', () => {
  const data = { people: [{ id: 'p1', name: 'Sam' }], meds: [{ id: 'x', personId: 'p1', name: 'Spray', prn: true, onHand: 2, countedOn: '2026-10-01' }] };
  const c = SM.cleanBackupData(data);
  assert.equal(c.meds.length, 1);
  assert.deepEqual(SM.medProblem(c.meds[0], new Set(['p1'])), { fatal: false, why: 'no-reorder-number' });
  assert.equal(SM.medProblem({ ...c.meds[0], minCount: 1 }, new Set(['p1'])), null);
});

test('checks: the list on the phone keeps damaged medicines so they can be fixed', () => {
  const data = { people: [{ id: 'p1', name: 'Sam' }], meds: [
    { id: 'a', personId: 'p1', name: 'Text count', perDay: 1, onHand: '10', countedOn: '2026-10-01' },
    { id: 'b', personId: 'p1', name: 'No date', perDay: 1, onHand: 10 },
    { id: 'c', personId: 'p1', name: 'Text schedule', perDay: 'two', onHand: 10, countedOn: '2026-10-01' },
    { id: 'd', personId: 'gone', name: 'Orphan', perDay: 1, onHand: 10, countedOn: '2026-10-01' },
  ] };
  const kept = SM.cleanList(data, undefined, { keepBroken: true });
  assert.equal(kept.meds.length, 4);
  assert.equal(kept.skipped, 0);
  const ids = new Set(['p1']);
  assert.deepEqual(kept.meds.map((m) => SM.medProblem(m, ids).why), ['count', 'count', 'schedule', 'no-person']);
  assert.equal(SM.cleanBackupData(data).meds.length, 0);       // a backup with these leaves them out
});

test('recount reminder: 90 days by default, per medicine, from the last hand count', () => {
  const t = '2026-10-20';
  const m = { perDay: 1, onHand: 200, countedOn: '2026-10-01', verifiedOn: '2026-07-22' }; // a pickup on Oct 1 moved countedOn only
  assert.deepEqual(SM.recountDue(m, t), { since: '2026-07-22', days: 90, due: true });
  assert.equal(SM.recountDue({ ...m, recountDays: 120 }, t).due, false);
  assert.equal(SM.recountDue({ ...m, verifiedOn: undefined }, t).since, '2026-10-01'); // older lists: falls back to countedOn
  assert.equal(SM.recountDue({ perDay: 0, prn: true, onHand: 2, countedOn: '2026-01-01' }, t), null); // as-needed: no estimate to drift
  // A saved setting outside 7..365 days (or not a number) falls back to the default; inside, it is rounded.
  assert.equal(SM.normalizeMed({ recountDays: 3 }).recountDays, undefined);
  assert.equal(SM.normalizeMed({ recountDays: 'x' }).recountDays, undefined);
  assert.equal(SM.normalizeMed({ recountDays: 45.4 }).recountDays, 45);
});

test('"last counted" wording', () => {
  const t = '2026-10-20';
  assert.equal(SM.agoText('2026-10-20', t), 'today');
  assert.equal(SM.agoText('2026-10-19', t), 'yesterday');
  assert.equal(SM.agoText('2026-10-07', t), '13 days ago');
  assert.equal(SM.agoText('2026-10-06', t), 'about 2 weeks ago');
  assert.equal(SM.agoText('2026-07-22', t), 'about 3 months ago');
  assert.equal(SM.agoText('2024-10-20', t), 'about 2 years ago');
});

test('needs doing today: one line per thing to do, most pressing first', () => {
  const t = '2026-10-20';
  const row = (m) => ({ m, l: SM.live(m, t) });
  const base = { perDay: 1, countedOn: t, verifiedOn: t };
  const rows = [
    row({ id: 'fine', ...base, onHand: 200 }),                                                   // nothing to do
    row({ id: 'recount', ...base, onHand: 200, verifiedOn: '2026-06-01' }),                     // recount due
    row({ id: 'order', ...base, onHand: 5 }),                                                    // order now
    row({ id: 'script', ...base, onHand: 15, controlled: true }),                               // contact prescriber (a week ahead)
    row({ id: 'ready', ...base, onHand: 50, refill: { stage: 'ready', requestedOn: '2026-10-15', readyOn: '2026-10-18' } }),
    row({ id: 'waiting', ...base, onHand: 50, refill: { stage: 'requested', requestedOn: '2026-10-18' } }), // 2 days: not yet
    row({ id: 'stale', ...base, onHand: 50, refill: { stage: 'requested', requestedOn: '2026-10-14' } }),   // 6 days: check
    row({ id: 'expired', ...base, onHand: 200, expiresOn: '2026-10-01', verifiedOn: '2026-01-01' }),       // expired; no recount line too
    row({ id: 'inhaler', perDay: 0, prn: true, minCount: 1, onHand: 1, countedOn: t }),         // as needed, at the reorder number
  ];
  const list = SM.todoList(rows, [{ m: { id: 'broken' }, why: 'count' }], t);
  assert.deepEqual(list.map((x) => `${x.kind}:${x.id}`),
    ['order:order', 'script:script', 'order:inhaler', 'check:stale', 'pickup:ready', 'fix:broken', 'expired:expired', 'recount:recount']);
  assert.equal(list.find((x) => x.id === 'stale').days, 6);
  // A requested refill that is about to run out is checked on right away, not after 5 days.
  const urgent = SM.todoList([row({ id: 'u', ...base, onHand: 2, refill: { stage: 'requested', requestedOn: t } })], [], t);
  assert.deepEqual(urgent.map((x) => x.kind), ['check']);
  assert.deepEqual(SM.todoList([rows[0]], [], t), []);
});

test('flyer QR uses the hosted folder, never a placeholder or a file link', () => {
  const published = 'https://frankoo6.github.io/medicine-shelf/';
  assert.equal(flyer.PUBLISHED, published);
  // A local file has no public address, so the QR uses the published app.
  assert.equal(flyer.flyerQrUrl('file:///Users/office/medicine-shelf/flyer.html'), published);
  assert.equal(flyer.flyerQrUrl('file:///C:/Users/office/medicine-shelf/flyer.html', ''), published);
  assert.equal(flyer.flyerQrUrl('file:///Users/office/medicine-shelf/flyer.html', 'https://example.org/medicine-shelf/'), published);
  // Hosted copies point at their own folder, without the page name or a query string.
  assert.equal(flyer.flyerQrUrl('https://frankoo6.github.io/medicine-shelf/flyer.html'), 'https://frankoo6.github.io/medicine-shelf/');
  assert.equal(flyer.flyerQrUrl('https://my-office.netlify.app/tools/medicine-shelf/flyer.html?x=1'), 'https://my-office.netlify.app/tools/medicine-shelf/');
  assert.equal(flyer.flyerQrUrl('http://localhost:8080/flyer.html', ''), 'http://localhost:8080/');
  // A link typed into the box is kept when it is a real http(s) address.
  assert.equal(flyer.flyerQrUrl('file:///tmp/flyer.html', 'https://clinic.example.netlify.app/shelf/'), 'https://clinic.example.netlify.app/shelf/');
  assert.equal(flyer.flyerQrUrl('file:///tmp/flyer.html', '  https://frankoo6.github.io/medicine-shelf/?ref=clinic  '), 'https://frankoo6.github.io/medicine-shelf/?ref=clinic');
  // Placeholder hosts and file links are not encoded, even when typed or when that is where the page sits.
  assert.equal(flyer.flyerQrUrl('https://example.org/medicine-shelf/flyer.html', ''), published);
  assert.equal(flyer.flyerQrUrl('https://www.example.com/medicine-shelf/flyer.html'), published);
  assert.equal(flyer.flyerQrUrl('https://EXAMPLE.NET/medicine-shelf/'), published);
  assert.equal(flyer.flyerQrUrl('https://my-office.netlify.app/flyer.html', 'https://example.org/medicine-shelf/'), 'https://my-office.netlify.app/');
  assert.equal(flyer.flyerQrUrl('https://my-office.netlify.app/flyer.html', 'file:///tmp/index.html'), 'https://my-office.netlify.app/');
  assert.equal(flyer.flyerQrUrl('https://my-office.netlify.app/flyer.html', 'not a url'), 'https://my-office.netlify.app/');
  assert.equal(flyer.flyerQrUrl('not a page'), published);
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
