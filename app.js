// Medicine Shelf app: everything the page does. Loaded after shelf-math.js (the date and supply math).
(() => {
  'use strict';
  const KEY = 'medicine-shelf.v1';
  const DEFAULTS = window.ShelfMath.DEFAULTS;
  const $ = (id) => document.getElementById(id);

  // ---------- storage ----------
  let storageOK = true;
  try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); } catch (e) { storageOK = false; }
  // The data format version. If the format ever changes, raise this and add a step to migrate() below.
  const DATA_VERSION = 1;
  const blank = () => ({ version: DATA_VERSION, people: [], meds: [], meta: {} });
  // Brings data saved by an older version of the app up to the current format, one version at a time.
  // There are no format changes yet; a future one adds: if (v === 1) { ...change data...; v = 2; }
  function migrate(data, fromVersion) {
    let v = Number.isInteger(fromVersion) && fromVersion >= 1 ? fromVersion : 1;
    while (v < DATA_VERSION) { v++; }
    return Object.assign(data, { version: DATA_VERSION });
  }
  // If the saved list can't be read, it is copied to a separate key and saving is blocked until the
  // person restores a backup or chooses to start over, so the next save can't overwrite it.
  const UNREADABLE_KEY = KEY + '.unreadable';
  let unreadable = null;
  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOK = false; return blank(); }
    if (!raw) return blank();
    const r = window.ShelfMath.parseSaved(raw);
    if (r.ok) return migrate(Object.assign(blank(), r.data), r.data.version);
    unreadable = raw;
    try { if (!localStorage.getItem(UNREADABLE_KEY)) localStorage.setItem(UNREADABLE_KEY, JSON.stringify({ keptAt: new Date().toISOString(), text: raw })); } catch (e) { /* the original is still under KEY */ }
    return blank();
  }
  let state = load();
  let lastSaveOk = true;
  function save() {
    if (unreadable) { lastSaveOk = false; return false; } // never overwrite a list we couldn't read
    try { localStorage.setItem(KEY, JSON.stringify(state)); lastSaveOk = true; }
    catch (e) { storageOK = false; lastSaveOk = false; $('storageWarn').hidden = false; }
    return lastSaveOk;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // Before Restore or Erase replaces everything, the current list is kept under its own key for
  // a week, so it can be brought back (the banner at the top, or Undo right after).
  const PREVIOUS_KEY = KEY + '.previous';
  function keepPrevious(reason) {
    if (!state.people.length) return;
    try { localStorage.setItem(PREVIOUS_KEY, JSON.stringify({ savedOn: window.ShelfMath.toStr(new Date()), reason, data: state })); } catch (e) {}
  }
  function readPrevious() {
    try { const p = JSON.parse(localStorage.getItem(PREVIOUS_KEY) || 'null'); return window.ShelfMath.previousOffered(p, window.ShelfMath.toStr(new Date())) ? p : null; }
    catch (e) { return null; }
  }
  function forgetPrevious() { try { localStorage.removeItem(PREVIOUS_KEY); } catch (e) {} }
  function bringBackPrevious() {
    const prev = readPrevious(); if (!prev) return;
    state = migrate(Object.assign(blank(), prev.data), prev.data.version);
    forgetPrevious(); filter = 'all'; view = 'home'; save(); render(); done('Your earlier list is back.');
  }
  // Counts real edits since the last backup, so the backup reminder can come back after several changes.
  const noteChange = () => { state.meta.changesSinceBackup = (state.meta.changesSinceBackup || 0) + 1; };

  // ---------- dates and supply math live in shelf-math.js ----------
  const SM = window.ShelfMath;
  const { toStr, parse, addDays, diff, maxDate, val, isScheduled } = SM;
  const today = () => toStr(new Date());
  const nice = (s) => {
    if (!s) return '—';
    const d = parse(s);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const personName = (id) => (state.people.find((p) => p.id === id) || {}).name || 'Someone';
  const plan = SM.plan;
  const live = (m) => SM.live(m, today());

  // ---------- helpers ----------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  // Numbers on screen keep up to 2 decimal places, so a daily amount like 0.25 never shows as 0.3.
  const fmt = (n) => String(SM.round2(n));
  // Singular form for exactly 1 of a unit ("1 tablet/day"). Listed by hand: "patches" is not "patche".
  const SINGULAR = { tablets: 'tablet', capsules: 'capsule', patches: 'patch', inhalers: 'inhaler', doses: 'dose' };
  const unitFor = (n, unit) => (n === 1 && SINGULAR[unit] ? SINGULAR[unit] : unit);
  let toastTimer;
  // Use after save(): shows the success message only if the save worked.
  function done(msg, undo, extra) {
    if (unreadable) toast('Not saved. Your saved list couldn’t be read: restore a backup or start a new list first (see the message at the top).');
    else if (lastSaveOk) toast(msg, undo, extra);
    else toast("Couldn't save. This browser isn't keeping data, so the change will be lost when you close it.");
  }
  // A short message at the bottom. Optional Undo, and optional extra = { label, fn } for a follow-up action.
  function toast(msg, undo, extra) {
    const t = $('toast'); t.replaceChildren(document.createTextNode(msg));
    const close = () => { clearTimeout(toastTimer); t.hidden = true; };
    if (extra) t.append(el('button', { class: 'toast-undo', type: 'button', onclick: () => { close(); extra.fn(); } }, extra.label));
    if (undo) t.append(el('button', { class: 'toast-undo', type: 'button', onclick: () => { close(); undo(); } }, 'Undo'));
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), extra ? 12000 : undo ? 9000 : 3200);
  }
  function scrollTo(node) { node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  function downloadFile(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- view state ----------
  let view = 'home', filter = 'all', editingMed = null, editingPerson = null, openAction = null;

  // Every change redraws the list, which would drop keyboard focus. Buttons carry a data-key so the
  // same button (or the form that just opened) gets focus back after the redraw.
  let focusAfter = null;
  function render() {
    const active = document.activeElement;
    const key = focusAfter || (active && active.dataset ? active.dataset.key : null);
    focusAfter = null;
    renderNow();
    if (!key) return;
    let n = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!n && key.includes(':')) n = document.querySelector(`[data-key="${CSS.escape(key.split(':')[0] + ':card')}"]`);
    if (n && n !== document.activeElement) n.focus({ preventScroll: true });
  }
  function renderNow() {
    $('storageWarn').hidden = storageOK;
    $('unreadableWarn').hidden = !unreadable;
    const prev = unreadable ? null : readPrevious();
    $('previousBanner').hidden = !prev;
    if (prev) {
      const what = prev.reason === 'erase' ? 'erased everything' : 'restored a backup';
      const until = nice(addDays(prev.savedOn, SM.UNDO_DAYS));
      $('previousText').textContent = `On ${nice(prev.savedOn)} you ${what}. The list from before (${prev.data.people.map((p) => p.name).join(', ')}) can be brought back until ${until}.`;
    }
    $('exampleBanner').hidden = !state.people.some((p) => p.example);
    const has = state.people.length > 0;
    $('welcome').hidden = has || view !== 'home';
    $('main').hidden = !has || view !== 'home';
    $('addMedTop').hidden = !has || view !== 'home';
    $('medlistView').hidden = view !== 'medlist';
    if (view === 'medlist') return renderSheet();
    if (!has) return;
    if (filter !== 'all' && !state.people.some((p) => p.id === filter)) filter = 'all';
    renderChips(); renderCards(); renderTools();
  }

  function renderChips() {
    const c = $('chips'); c.replaceChildren();
    if (state.people.length === 1) filter = state.people[0].id;
    const mk = (id, label) => el('button', { class: 'chip', type: 'button', 'data-key': `chip:${id}`, 'aria-pressed': String(filter === id), onclick: () => { filter = id; openAction = null; render(); } }, label);
    if (state.people.length > 1) c.append(mk('all', 'Everyone'));
    for (const p of state.people) c.append(mk(p.id, p.name));
    c.append(el('button', { class: 'chip add', type: 'button', onclick: () => openPersonForm() }, '+ Add person'));
    if (filter !== 'all') c.append(el('button', { class: 'link', type: 'button', onclick: () => openPersonForm(state.people.find((p) => p.id === filter)) }, `Edit ${personName(filter)}`));
  }

  function renderCards() {
    // A medicine whose saved data is damaged (e.g. no count date) can't be worked out. It gets its own
    // "needs fixing" card instead of breaking every card on the page.
    const rows = [], broken = [];
    for (const m of state.meds) {
      try { rows.push({ m, l: live(m) }); } catch (e) { broken.push(m); }
    }
    const inView = rows.filter((r) => filter === 'all' || r.m.personId === filter);
    $('cNow').textContent = inView.filter((r) => r.l.status === 'now').length;
    $('cSoon').textContent = inView.filter((r) => r.l.status === 'soon').length;
    $('cOk').textContent = inView.filter((r) => r.l.status === 'ok').length;
    const rank = { now: 0, soon: 1, ok: 2 };
    inView.sort((a, b) => rank[a.l.status] - rank[b.l.status] || (a.l.p.orderOn || '9999').localeCompare(b.l.p.orderOn || '9999') || a.m.name.localeCompare(b.m.name));
    const list = $('list'); list.replaceChildren();
    if (!inView.length) {
      const who = filter === 'all' ? 'anyone' : personName(filter);
      list.append(el('div', { class: 'empty' },
        el('h3', {}, `No medicines for ${who} yet`),
        el('p', { class: 'note' }, 'Grab the bottle. Enter the name, how many are taken a day and how many are in it right now. The app works out the rest.'),
        el('button', { class: 'primary', type: 'button', onclick: () => openMedForm() }, 'Add a medicine')));
    }
    for (const m of broken) if (filter === 'all' || m.personId === filter) list.append(brokenCard(m));
    for (const { m, l } of inView) {
      try { list.append(card(m, l)); } catch (e) { list.append(brokenCard(m)); }
    }
    const last = state.meta.lastBackup;
    const realMeds = state.meds.filter((m) => !m.example).length;
    const changedSince = (state.meta.changesSinceBackup || 0) >= 5;
    const pending = state.meta.backupPending;
    $('backupConfirm').hidden = !pending;
    $('backupNudge').hidden = !!pending || !(realMeds >= 1 && (!last || diff(last, today()) > 60 || changedSince));
  }

  function card(m, l) {
    const t = today(), p = l.p;
    const facts = el('div', { class: 'facts' });
    const fact = (label, value, big) => el('div', { class: 'fact' + (big ? ' big' : '') }, el('span', { class: 'eyebrow' }, label), el('span', { class: 'v' }, value));
    if (isScheduled(m)) {
      facts.append(fact('Days left', l.daysLeft, true), fact('Order on', p.orderOn <= t ? 'Now' : nice(p.orderOn)), fact('Runs out', nice(p.runOut)), fact('Estimated left', `≈ ${fmt(l.est)}`));
    } else {
      facts.append(fact('Last count', fmt(l.est), true), fact('Reorder below', m.minCount ?? '—'), fact('Taken', 'As needed'), fact('Counted', nice(m.countedOn)));
    }
    const warns = [];
    if (p.tight) warns.push(el('div', { class: 'warn-line hard' }, p.eligibleConfirmed
      ? `The pharmacy's next refill date is ${nice(p.eligible)}, but it runs out about ${nice(p.runOut)}. Call the pharmacy or prescriber now.`
      : `Insurance may not allow this refill until about ${nice(p.eligible)} (an estimate), but it runs out about ${nice(p.runOut)}. Call the pharmacy now, or recount in case the number is off.`));
    // Read the refill stage from its own field: expiry can take over the label without hiding a refill in progress.
    const stage = l.refillStage || null;
    if (stage === 'requested' && l.stageDays >= 5) warns.push(el('div', { class: 'warn-line' + (l.stageUrgent ? ' hard' : '') }, `Requested ${l.stageDays} days ago and not marked ready. Check with the pharmacy${p.needsScript ? " or the prescriber's office" : ''}.`));
    if (stage === 'ready' && l.stageDays >= 7) warns.push(el('div', { class: 'warn-line' }, `Ready since ${nice(l.stageSince)}. Pharmacies may put unclaimed refills back after a week or two.`));
    if (stage && l.stageUrgent) warns.push(el('div', { class: 'warn-line hard' }, isScheduled(m) ? `Only about ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left. Make sure this refill reaches you in time.` : 'None left. Make sure this refill reaches you soon.'));
    if (p.needsScript && !stage) {
      const why = m.controlled ? 'Needs a new prescription each time.' : 'No refills left.';
      const scriptNow = l.action === 'script' || (l.action === 'order' && !isScheduled(m));
      let text;
      if (!p.callDoctor) text = `${why} Contact the prescriber's office when you reorder, so it can send a new prescription.`;
      else if (p.callDoctor <= t) text = `${why} Contact the prescriber's office now. The order date is ${p.orderOn <= t ? 'today' : nice(p.orderOn)}.`;
      else text = `${why} Contact the prescriber's office by ${nice(p.callDoctor)}.`;
      warns.push(el('div', { class: 'warn-line' + (scriptNow || (p.callDoctor && p.callDoctor <= t) ? ' hard' : '') }, text));
    }
    if (l.expiresIn != null && l.expiresIn < 0) warns.push(el('div', { class: 'warn-line hard' }, `Expired on ${nice(m.expiresOn)}. Ask your pharmacy about a replacement.`));
    else if (l.expiresIn != null && l.expiresIn <= SM.EXPIRY_SOON_DAYS) warns.push(el('div', { class: 'warn-line' }, `Expires ${nice(m.expiresOn)}, in ${l.expiresIn} day${l.expiresIn === 1 ? '' : 's'}.`));
    else if (l.expiresBeforeRunOut) warns.push(el('div', { class: 'warn-line' }, `Expires ${nice(m.expiresOn)}, before you'd finish this supply (about ${nice(p.runOut)}).`));
    if (isScheduled(m) && diff(m.verifiedOn ?? m.countedOn, t) > 120) warns.push(el('div', { class: 'warn-line' }, `Last counted ${nice(m.verifiedOn ?? m.countedOn)}. A quick recount keeps the dates right.`));

    const meta = el('div', { class: 'meta' },
      isScheduled(m) ? el('span', {}, `${fmt(m.perDay)} ${unitFor(m.perDay, m.unit)}/day`) : null,
      p.eligible ? el('span', {}, p.eligibleConfirmed ? `Pharmacy says refill from ${nice(p.eligible)}` : `Estimated refill eligibility ${nice(p.eligible)}`) : null,
      m.refillsLeft != null ? el('span', {}, `${m.refillsLeft} refill${m.refillsLeft === 1 ? '' : 's'} left`) : null,
      m.pharmacy ? el('span', {}, m.pharmacy) : null,
      m.pharmacyPhone ? el('a', { href: 'tel:' + m.pharmacyPhone.replace(/[^\d+]/g, '') }, m.pharmacyPhone) : null,
      m.rxNumber ? el('span', {}, `Rx ${m.rxNumber}`) : null,
      m.expiresOn && !(l.expiresIn <= SM.EXPIRY_SOON_DAYS) ? el('span', {}, `Expires ${nice(m.expiresOn)}`) : null);

    // Refill progress: Requested -> Ready -> Picked up. Only "Picked up" changes the count.
    const progress = stage ? el('ol', { class: 'steps', 'aria-label': 'Refill progress' },
      el('li', { class: 'done' }, el('b', {}, 'Requested'), ` ${nice(m.refill.requestedOn)}`),
      el('li', { class: stage === 'ready' ? 'done' : 'next' }, el('b', {}, 'Ready'), stage === 'ready' ? ` ${nice(m.refill.readyOn)}` : ''),
      el('li', { class: stage === 'ready' ? 'next' : '' }, el('b', {}, 'Picked up'))) : null;

    const wantsOrder = !stage && l.status !== 'ok';
    const actions = el('div', { class: 'actions' },
      !stage ? el('button', { class: wantsOrder ? 'primary' : '', type: 'button', 'data-key': `${m.id}:requested`, onclick: () => setStage(m, 'requested') }, 'I requested a refill') : null,
      stage === 'requested' ? el('button', { class: 'primary', type: 'button', 'data-key': `${m.id}:ready`, onclick: () => setStage(m, 'ready') }, 'It’s ready for pickup') : null,
      el('button', { class: wantsOrder || stage === 'requested' ? '' : 'primary', type: 'button', 'data-key': `${m.id}:refill`, onclick: () => toggleAction(m.id, 'refill') }, 'Picked up a refill'),
      el('button', { type: 'button', 'data-key': `${m.id}:recount`, onclick: () => toggleAction(m.id, 'recount') }, 'Recount'),
      (isScheduled(m) || m.expiresOn) && !stage ? el('button', { type: 'button', 'data-key': `${m.id}:calendar`, onclick: () => addToCalendar([m]) }, 'Add to calendar') : null,
      stage ? el('button', { class: 'link', type: 'button', 'data-key': `${m.id}:cancel`, onclick: () => setStage(m, null) }, 'Cancel request') : null,
      el('button', { class: 'link', type: 'button', 'data-key': `${m.id}:edit`, onclick: () => openMedForm(m) }, 'Edit'));

    const body = el('div', { class: 'label-body' }, facts, progress, warns, meta, actions);
    if (openAction && openAction.id === m.id) body.append(actionForm(m, l, openAction.kind));
    const label = { order: 'Order now', script: 'Contact prescriber', soon: 'Order soon', ok: 'Stocked', requested: 'Requested', ready: 'Ready for pickup', expired: 'Expired', expiring: 'Expires soon' }[l.action];
    return el('article', { class: 'label', tabindex: '-1', 'data-key': `${m.id}:card`, 'aria-label': `${m.name}, ${label}` },
      el('div', { class: 'label-head' },
        el('h3', {}, m.name, m.strength ? ` ${m.strength}` : ''),
        el('div', { class: 'actions' }, state.people.length > 1 ? el('span', { class: 'who' }, personName(m.personId)) : null, el('span', { class: 'pill ' + l.status }, label))),
      body);
  }

  // Shown in place of a normal card when a medicine's saved data is damaged.
  function brokenCard(m) {
    const name = typeof m.name === 'string' && m.name ? m.name : 'A medicine';
    const body = el('div', { class: 'label-body' },
      el('div', { class: 'warn-line hard' }, `The saved count for ${name} is damaged, so its dates can't be worked out. Count what you have now to fix it, or remove it.`),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', type: 'button', 'data-key': `${m.id}:recount`, onclick: () => toggleAction(m.id, 'recount') }, 'Count it now'),
        el('button', { class: 'link', type: 'button', onclick: () => {
          if (!confirm(`Remove ${name}? This can't be undone.`)) return;
          state.meds = state.meds.filter((x) => x !== m); save(); render(); done(`Removed ${name}.`);
        } }, 'Remove')));
    if (openAction && openAction.id === m.id) body.append(actionForm(m, null, 'recount'));
    return el('article', { class: 'label', tabindex: '-1', 'data-key': `${m.id}:card` },
      el('div', { class: 'label-head' }, el('h3', {}, name), el('span', { class: 'pill now' }, 'Needs fixing')), body);
  }
  function setStage(m, stage) {
    const before = m.refill ? { ...m.refill } : null;
    const t = today();
    if (stage === 'requested') m.refill = { stage, requestedOn: t };
    else if (stage === 'ready') m.refill = { ...(m.refill || { requestedOn: t }), stage, readyOn: t };
    else m.refill = null;
    noteChange(); openAction = null; save(); render();
    const msg = stage === 'requested' ? `Marked ${m.name} as requested.` : stage === 'ready' ? `Marked ${m.name} as ready for pickup.` : `Cancelled the refill request for ${m.name}.`;
    done(msg, () => { m.refill = before; save(); render(); done('Undone.'); });
  }
  function toggleAction(id, kind) {
    const closing = openAction && openAction.id === id && openAction.kind === kind;
    openAction = closing ? null : { id, kind };
    focusAfter = closing ? `${id}:${kind}` : `${id}:qty`;
    render();
  }
  function actionForm(m, l, kind) {
    const qid = `act_qty_${m.id}`, did = `act_date_${m.id}`;
    const t = today();
    const qty = el('input', { id: qid, 'data-key': `${m.id}:qty`, type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: kind === 'refill' ? SM.suggestedPickup(m) : (l ? fmt(l.est) : '') });
    const date = el('input', { id: did, type: 'date', value: t, max: t });
    // A new package has a new expiry date; asked only for medicines whose expiry is being tracked.
    const eid = `act_exp_${m.id}`;
    const exp = kind === 'refill' && m.expiresOn ? el('input', { id: eid, type: 'date' }) : null;
    const preview = el('p', { class: 'note', style: 'flex-basis:100%', 'aria-live': 'polite' });
    const updatePreview = () => {
      const q = Number(qty.value), d = date.value;
      if (kind !== 'refill' || qty.value === '' || !(q > 0) || !d) { preview.textContent = ''; return; }
      let est; try { est = SM.estimateOn(m, d); } catch (e) { preview.textContent = ''; return; }
      preview.textContent = `${isScheduled(m) ? '≈ ' : ''}${fmt(est)} left + ${fmt(q)} picked up = ${fmt(est + q)}`;
    };
    qty.addEventListener('input', updatePreview); date.addEventListener('input', updatePreview); updatePreview();
    const go = el('button', { class: 'primary', type: 'button' }, kind === 'refill' ? 'Add to count' : 'Save count');
    go.addEventListener('click', () => {
      const q = Number(qty.value), d = date.value;
      if (qty.value === '' || !(q >= 0) || !d) return toast('Enter a number and a date.');
      if (kind === 'refill' && !(q > 0)) return toast('Enter how many you picked up. It has to be more than zero.');
      if (d > today()) return toast("The date can't be in the future.");
      if (SM.isDateStr(m.countedOn) && d < m.countedOn) return toast(`That's before your last count on ${nice(m.countedOn)}. ${kind === 'refill' ? 'If this refill was already in that count, there is nothing to add.' : 'Use a date on or after it.'}`);
      const before = { expiresOn: m.expiresOn ?? null, onHand: m.onHand, countedOn: m.countedOn, verifiedOn: m.verifiedOn ?? null, lastFillDate: m.lastFillDate ?? null, refillsLeft: m.refillsLeft ?? null, confirmedRefill: m.confirmedRefill ?? null, lastFillQty: m.lastFillQty ?? null, refill: m.refill ? { ...m.refill } : null };
      if (kind === 'refill') {
        Object.assign(m, SM.applyPickup(m, q, d));
        if (exp) m.expiresOn = exp.value || null;
      } else Object.assign(m, { onHand: q, countedOn: d, verifiedOn: d });
      noteChange(); openAction = null; focusAfter = `${m.id}:${kind}`; save(); render();
      // The order date just moved: if this medicine is on the calendar, offer to update the reminder.
      const offerCalendar = kind === 'refill' && m.calendarOn && (isScheduled(m) || SM.isDateStr(m.expiresOn))
        ? { label: 'Update calendar', fn: () => addToCalendar([m]) } : null;
      done(kind === 'refill' ? `Added ${fmt(q)} to ${m.name}.${offerCalendar ? ' Your calendar reminder has the old date.' : ''}` : `Saved the count for ${m.name}.`, () => {
        Object.assign(m, before); save(); render(); done(`Undone. ${m.name} is back to how it was.`);
      }, offerCalendar);
    });
    return el('div', { class: 'inline' },
      el('label', { for: qid }, kind === 'refill' ? 'How many you picked up' : `How many ${m.unit} you have`, qty),
      el('label', { for: did }, kind === 'refill' ? 'Picked up on' : 'Counted on', date),
      exp ? el('label', { for: eid }, 'Expiry on the new package (blank if not shown)', exp) : null,
      go, el('button', { type: 'button', onclick: () => { openAction = null; focusAfter = `${m.id}:${kind}`; render(); } }, 'Cancel'), preview);
  }

  function renderTools() {
    const last = state.meta.lastBackup;
    $('backupInfo').textContent = (last ? `Last backup saved ${nice(last)}. ` : 'No backup saved yet. ') + 'A backup file lists your medicines, prescribers and Rx numbers in plain text: keep it somewhere private.';
  }

  // ---------- people ----------
  function openPersonForm(p) {
    editingPerson = p ? p.id : null;
    $('personFormTitle').textContent = p ? `Edit ${p.name}` : 'Add a person';
    $('p_name').value = p ? p.name : ''; $('p_allergies').value = p ? p.allergies || '' : '';
    $('personDelete').hidden = !p;
    $('medForm').hidden = true; $('personForm').hidden = false; scrollTo($('personForm')); $('p_name').focus({ preventScroll: true });
  }
  $('personForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('p_name').value.trim(); if (!name) return;
    if (editingPerson) Object.assign(state.people.find((p) => p.id === editingPerson), { name, allergies: $('p_allergies').value.trim() });
    else { const p = { id: uid(), name, allergies: $('p_allergies').value.trim() }; state.people.push(p); filter = p.id; }
    save(); $('personForm').hidden = true; render(); done(`Saved ${name}.`);
  });
  $('personCancel').addEventListener('click', () => { $('personForm').hidden = true; });
  $('personDelete').addEventListener('click', () => {
    const p = state.people.find((x) => x.id === editingPerson); if (!p) return;
    const n = state.meds.filter((m) => m.personId === p.id).length;
    if (!confirm(`Remove ${p.name}${n ? ` and their ${n} medicine${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
    state.people = state.people.filter((x) => x.id !== p.id); state.meds = state.meds.filter((m) => m.personId !== p.id);
    filter = 'all'; save(); $('personForm').hidden = true; render(); done(`Removed ${p.name}.`);
  });
  $('firstPerson').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('firstName').value.trim(); if (!name) return;
    if (unreadable) return done('');
    const p = { id: uid(), name, allergies: '' };
    state.people.push(p); filter = p.id; save(); render(); openMedForm();
  });

  // ---------- medicines ----------
  const F = (k) => $('f_' + k);
  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  function openMedForm(m) {
    editingMed = m ? m.id : null;
    F('countedOn').max = today(); F('lastFill').max = today();
    $('medFormTitle').textContent = m ? `Edit ${m.name}` : 'Add a medicine';
    F('person').replaceChildren(...state.people.map((p) => new Option(p.name, p.id)));
    F('person').value = m ? m.personId : filter !== 'all' ? filter : state.people[0].id;
    F('name').value = m?.name || ''; F('strength').value = m?.strength || ''; F('unit').value = m?.unit || 'tablets';
    F('perDay').value = m?.perDay ?? ''; F('prn').checked = !!m?.prn; F('min').value = m?.minCount ?? ''; $('minWrap').hidden = !F('prn').checked; F('min').required = F('prn').checked;
    // Editing never touches the count: only Recount and Picked up a refill change it.
    F('onHand').value = ''; F('countedOn').value = today();
    for (const id of ['onHandWrap', 'countedOnWrap']) $(id).hidden = !!m;
    F('onHand').required = !m; F('countedOn').required = !m; $('countNote').hidden = !m;
    F('instructions').value = m?.instructions || '';
    F('lastFill').value = m?.lastFillDate || ''; F('confirmed').value = m?.confirmedRefill || '';
    F('fillDays').value = String(val(m || {}, 'fillDays')); F('refills').value = m?.refillsLeft ?? '';
    F('controlled').checked = !!m?.controlled; F('prescriber').value = m?.prescriber || ''; F('pharmacy').value = m?.pharmacy || '';
    F('pharmacyPhone').value = m?.pharmacyPhone || ''; F('rx').value = m?.rxNumber || ''; F('expires').value = m?.expiresOn || '';
    F('lead').value = val(m || {}, 'leadDays'); F('buffer').value = val(m || {}, 'bufferDays'); F('pct').value = val(m || {}, 'eligiblePct');
    $('medDelete').hidden = !m;
    $('personForm').hidden = true; $('medForm').hidden = false; scrollTo($('medForm')); F('name').focus({ preventScroll: true });
  }
  F('prn').addEventListener('change', () => { $('minWrap').hidden = !F('prn').checked; F('min').required = F('prn').checked; });
  $('medCancel').addEventListener('click', () => { $('medForm').hidden = true; });
  $('addMedTop').addEventListener('click', () => openMedForm());
  $('medDelete').addEventListener('click', () => {
    const m = state.meds.find((x) => x.id === editingMed); if (!m) return;
    if (!confirm(`Remove ${m.name}? This can't be undone.`)) return;
    state.meds = state.meds.filter((x) => x.id !== m.id); save(); $('medForm').hidden = true; render(); done(`Removed ${m.name}.`);
  });
  $('medForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const prn = F('prn').checked, perDay = numOrNull(F('perDay').value);
    if (!prn && !(perDay > 0)) { toast('Enter how many a day, or tick "Taken only as needed".'); F('perDay').focus(); return; }
    // The browser's min="0" doesn't stop a typed minus sign, so check numbers and dates here too.
    const bad = (field, msg) => { toast(msg); F(field).focus(); return true; };
    const neg = (field) => { const v = numOrNull(F(field).value); return v != null && !(v >= 0); };
    if (neg('perDay')) return void bad('perDay', "How many a day can't be negative.");
    if (!editingMed && neg('onHand')) return void bad('onHand', "How many you have can't be negative.");
    if (prn && neg('min')) return void bad('min', "The reorder number can't be negative.");
    // Without a reorder number an as-needed medicine could never show 'Order now'.
    if (prn && numOrNull(F('min').value) == null) return void bad('min', 'Enter how many to reorder below, so the app can tell you when to reorder.');
    const refills = numOrNull(F('refills').value);
    if (refills != null && !(Number.isInteger(refills) && refills >= 0)) return void bad('refills', 'Refills left should be a whole number, 0 or more.');
    if (neg('lead')) return void bad('lead', "Days the pharmacy needs can't be negative.");
    if (neg('buffer')) return void bad('buffer', "Extra days can't be negative.");
    const pct = numOrNull(F('pct').value);
    if (pct != null && !(pct >= 50 && pct <= 100)) return void bad('pct', 'The insurance percent should be between 50 and 100.');
    if (F('lastFill').value && F('lastFill').value > today()) return void bad('lastFill', "The last pickup date can't be in the future.");
    if (F('lastFill').value && F('confirmed').value && F('confirmed').value < F('lastFill').value) return void bad('confirmed', 'The next refill date should be after the last pickup.');
    const prev = state.meds.find((x) => x.id === editingMed);
    let count;
    if (!prev) {
      if (F('countedOn').value > today()) { toast("The date counted can't be in the future."); return; }
      count = { onHand: Number(F('onHand').value), countedOn: F('countedOn').value, verifiedOn: F('countedOn').value };
    } else if ((perDay || 0) !== prev.perDay || prn !== !!prev.prn) {
      // The schedule changed: carry the count forward to today at the OLD rate, so past use isn't re-figured at the new one.
      // Not a physical count, so verifiedOn (used for the "recount" reminder) stays as it was.
      count = { onHand: SM.estimateOn(prev, today()), countedOn: today(), verifiedOn: prev.verifiedOn ?? prev.countedOn };
    } else count = {};
    const m = Object.assign(prev || { id: uid() }, count, {
      personId: F('person').value, name: F('name').value.trim(), strength: F('strength').value.trim(), unit: F('unit').value,
      perDay: perDay || 0, prn, minCount: prn ? numOrNull(F('min').value) : null,
      instructions: F('instructions').value.trim(),
      lastFillDate: F('lastFill').value || null, confirmedRefill: F('confirmed').value || null,
      // The amount from the last recorded pickup only applies to that pickup's date.
      lastFillQty: prev && prev.lastFillDate === (F('lastFill').value || null) ? prev.lastFillQty ?? null : null,
      fillDays: Number(F('fillDays').value), refillsLeft: numOrNull(F('refills').value),
      controlled: F('controlled').checked, prescriber: F('prescriber').value.trim(), pharmacy: F('pharmacy').value.trim(),
      pharmacyPhone: F('pharmacyPhone').value.trim(), rxNumber: F('rx').value.trim(), expiresOn: F('expires').value || null,
      leadDays: numOrNull(F('lead').value) ?? DEFAULTS.leadDays, bufferDays: numOrNull(F('buffer').value) ?? DEFAULTS.bufferDays,
      eligiblePct: numOrNull(F('pct').value) ?? DEFAULTS.eligiblePct,
    });
    if (!prev) state.meds.push(m);
    noteChange(); save(); $('medForm').hidden = true; filter = state.people.length > 1 && filter === 'all' ? 'all' : m.personId; render();
    done(`Saved ${m.name}.`);
  });

  // ---------- calendar (.ics) ----------
  function fold(line) {
    const enc = new TextEncoder(); const parts = []; let cur = '', bytes = 0, limit = 75;
    for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; } cur += ch; bytes += b; }
    parts.push(cur); return parts.join('\r\n ');
  }
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const ymd = (s) => s.replace(/-/g, '');
  // Each medicine keeps the SAME event id (UID) every time it is added, with a higher SEQUENCE number,
  // so calendars that follow the standard replace the old reminder instead of adding a second one.
  function vevent(id, date, summary, description) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const sequence = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000); // minutes since 2026: always rising
    return ['BEGIN:VEVENT', `UID:${id}@medicine-shelf`, `SEQUENCE:${sequence}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`,
      `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(description)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT'];
  }
  function buildIcs(meds) {
    const t = today(), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Medicine Shelf//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const m of meds) {
      let p; try { p = plan(m); } catch (e) { continue; } // skip a medicine with damaged data
      const who = personName(m.personId);
      // Expiry reminder two weeks ahead (or today if that's already passed), with its own stable id.
      if (SM.isDateStr(m.expiresOn) && m.expiresOn >= t) {
        lines.push(...vevent(`${m.id}-expiry`, maxDate(addDays(m.expiresOn, -14), t), `Replace ${m.name} for ${who}: expires ${nice(m.expiresOn)}`, 'Ask your pharmacy about a replacement before it expires.'));
      }
      if (!p.orderOn) continue;
      const details = [`Runs out about ${nice(p.runOut)}.`, m.pharmacy && `Pharmacy: ${m.pharmacy}`, m.pharmacyPhone && `Phone: ${m.pharmacyPhone}`, m.rxNumber && `Rx: ${m.rxNumber}`].filter(Boolean).join('\n');
      lines.push(...vevent(`${m.id}-order`, maxDate(p.orderOn, t), `Order ${m.name} for ${who}`, details));
      if (p.needsScript) lines.push(...vevent(`${m.id}-script`, maxDate(p.callDoctor, t), `Ask for a new ${m.name} prescription for ${who}`, `Order date is ${nice(p.orderOn)}.`));
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  function addToCalendar(meds) {
    const sched = meds.filter((m) => isScheduled(m) || SM.isDateStr(m.expiresOn));
    if (!sched.length) return toast('No order or expiry dates to add yet.');
    downloadFile(sched.length === 1 ? `order-${sched[0].name.replace(/[^\w-]+/g, '-').toLowerCase()}.ics` : 'medicine-order-dates.ics', buildIcs(sched), 'text/calendar');
    // Remember which medicines are on the calendar, so a refill can offer to update the reminder.
    for (const m of sched) m.calendarOn = today();
    save();
    toast('Calendar file made. Open it to add the reminder. Most calendars replace the earlier one; if you see two, delete the older.');
  }

  // ---------- backup ----------
  async function backup() {
    const name = `medicine-shelf-backup-${today()}.json`;
    const text = JSON.stringify({ app: 'medicine-shelf', version: DATA_VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2);
    const file = typeof File === 'function' ? new File([text], name, { type: 'application/json' }) : null;
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: 'Medicine Shelf backup' });
      } else downloadFile(name, text, 'application/json');
    } catch (e) { if (e && e.name === 'AbortError') return; downloadFile(name, text, 'application/json'); }
    // Sharing or downloading doesn't prove the file was kept (a share can go to a chat that gets deleted,
    // a download can be dismissed), so the reminder only clears after the person says they kept it.
    state.meta.backupPending = { date: today(), changes: state.meta.changesSinceBackup || 0 };
    save(); render(); toast('The file lists your medicines in plain text, so keep it somewhere private.');
  }
  const onRestore = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.app !== 'medicine-shelf' || !j.data || !Array.isArray(j.data.people) || !Array.isArray(j.data.meds)) throw new Error('not ours');
        const fileVersion = Number(j.version ?? j.data.version ?? 1);
        if (fileVersion > DATA_VERSION) { toast('This backup was made by a newer version of Medicine Shelf. Open the app while online so it updates, then restore again.'); return; }
        j.data = migrate(j.data, fileVersion);
        // Check every person and medicine; a damaged row is skipped instead of breaking the whole app.
        const clean = SM.cleanBackupData(j.data);
        const np = clean.people.length, nm = clean.meds.length, when = j.exportedAt ? nice(String(j.exportedAt).slice(0, 10)) : 'an unknown date';
        if (!np) { toast("That backup has no one in it that can be loaded."); return; }
        const skippedNote = clean.skipped ? `\n\n${clean.skipped} damaged ${clean.skipped === 1 ? 'entry' : 'entries'} in the file will be left out.` : '';
        if (!confirm(`This backup from ${when} has ${np} ${np === 1 ? 'person' : 'people'} and ${nm} ${nm === 1 ? 'medicine' : 'medicines'}: ${clean.people.map((x) => x.name).join(', ')}.${skippedNote}\n\nReplace everything on this device with it?`)) return;
        // The file you just restored from IS the latest backup of this list, so its date becomes the "last backup" date.
        const fileDate = String(j.exportedAt || '').slice(0, 10);
        const meta = Object.assign({}, j.data.meta, { lastBackup: SM.isDateStr(fileDate) ? fileDate : null, changesSinceBackup: 0 });
        unreadable = null; // a restored backup replaces the damaged list; the damaged copy stays under its own key
        keepPrevious('restore');
        state = Object.assign(blank(), j.data, { people: clean.people, meds: clean.meds, meta });
        filter = 'all'; view = 'home'; save(); render(); done('Backup restored.', readPrevious() ? bringBackPrevious : null);
      } catch (err) { toast("That file isn't a Medicine Shelf backup."); }
    };
    r.readAsText(f);
  };
  document.querySelectorAll('#restoreFile, .restore-input').forEach((inp) => inp.addEventListener('change', onRestore));

  // ---------- example household (for demos and first-time visitors) ----------
  function loadExample() {
    if (unreadable) return done('');
    const d = (n) => addDays(today(), n);
    const ex = { example: true };
    state.people.push(
      { id: 'ex-p1', name: 'Pat (example)', allergies: 'Penicillin', ...ex },
      { id: 'ex-p2', name: 'Jamie (example)', allergies: '', ...ex });
    state.meds.push(
      { id: 'ex-m1', personId: 'ex-p1', name: 'Metformin', strength: '500 mg', unit: 'tablets', perDay: 2, prn: false, onHand: 160, countedOn: d(0), lastFillDate: d(-10), fillDays: 90, refillsLeft: 3, pharmacy: 'Main Street Pharmacy', rxNumber: '1000001', prescriber: 'Dr. Example', instructions: '1 tablet twice a day with food', ...ex },
      { id: 'ex-m2', personId: 'ex-p1', name: 'Lisinopril', strength: '10 mg', unit: 'tablets', perDay: 1, prn: false, onHand: 12, countedOn: d(0), lastFillDate: d(-78), fillDays: 90, refillsLeft: 0, pharmacy: 'Main Street Pharmacy', rxNumber: '1000002', prescriber: 'Dr. Example', instructions: '1 tablet every morning', refill: { stage: 'requested', requestedOn: d(-2) }, ...ex },
      { id: 'ex-m3', personId: 'ex-p2', name: 'Methylphenidate ER', strength: '36 mg', unit: 'tablets', perDay: 1, prn: false, onHand: 9, countedOn: d(0), lastFillDate: d(-21), fillDays: 30, controlled: true, eligiblePct: 80, pharmacy: 'Main Street Pharmacy', prescriber: 'Dr. Example', instructions: '1 tablet every morning', ...ex },
      { id: 'ex-m4', personId: 'ex-p2', name: 'Albuterol inhaler', strength: '90 mcg', unit: 'inhalers', perDay: 0, prn: true, minCount: 1, onHand: 1, countedOn: d(-5), expiresOn: d(21), instructions: 'As needed for wheezing', ...ex });
    filter = 'all'; view = 'home'; save(); render(); window.scrollTo(0, 0);
  }
  function clearExample() {
    state.people = state.people.filter((p) => !p.example);
    state.meds = state.meds.filter((m) => !m.example);
    filter = 'all'; save(); render(); window.scrollTo(0, 0);
    if (!state.people.length) $('firstName').focus();
  }

  // ---------- larger text (a per-device display setting) ----------
  const BIG = KEY + '.bigText';
  function applyBig(on) {
    document.documentElement.classList.toggle('big', on);
    document.querySelectorAll('[data-act="bigtext"]').forEach((b) => (b.textContent = on ? 'Make the text normal size' : 'Make the text larger'));
  }
  try { applyBig(localStorage.getItem(BIG) === '1'); } catch (e) {}

  // ---------- medication list for appointments ----------
  // The printable medication list for one person, as a list of nodes.
  function sheetContent(p) {
    const meds = state.meds.filter((m) => m.personId === p.id).sort((a, b) => a.name.localeCompare(b.name));
    const how = (m) => m.instructions || (m.prn ? 'As needed' : `${fmt(m.perDay)} ${unitFor(m.perDay, m.unit)} a day`);
    return [
      el('div', {}, el('span', { class: 'eyebrow' }, 'Medication list'), el('h1', {}, p.name), el('p', { class: 'note' }, `Updated ${nice(today())}`)),
      el('p', {}, el('b', {}, 'Allergies: '), p.allergies || '____________________________________'),
      meds.length
        ? el('div', { class: 'scroll' }, el('table', {},
            el('thead', {}, el('tr', {}, ['Medicine', 'Strength', 'How it is taken', 'Prescribed by', 'Pharmacy and Rx'].map((h) => el('th', { scope: 'col' }, h)))),
            el('tbody', {}, meds.map((m) => el('tr', {},
              el('td', {}, el('b', {}, m.name)), el('td', {}, m.strength || ''), el('td', {}, how(m)), el('td', {}, m.prescriber || ''),
              el('td', {}, [m.pharmacy, m.rxNumber && `Rx ${m.rxNumber}`].filter(Boolean).join(' · ')))))))
        : el('p', { class: 'note' }, `No medicines entered for ${p.name} yet.`),
      el('div', {}, el('b', {}, 'Other medicines, vitamins or supplements'), el('div', { class: 'write-lines' }, el('span'), el('span'))),
      el('div', {}, el('b', {}, 'Changes made at this visit'), el('div', { class: 'write-lines' }, el('span'), el('span'), el('span'))),
      el('p', { class: 'note' }, 'Show this list at appointments and the pharmacy. Made with Medicine Shelf, which tracks supply only.'),
    ];
  }
  function renderSheet() {
    // Rebuilt every time so a renamed person shows the new name; the current choice is kept.
    const sel = $('mlPerson');
    const keep = sel.value || (filter !== 'all' ? filter : state.people[0].id);
    sel.replaceChildren(...state.people.map((p) => new Option(`${p.name}'s list`, p.id)));
    sel.value = state.people.some((p) => p.id === keep) ? keep : state.people[0].id;
    const p = state.people.find((x) => x.id === sel.value) || state.people[0];
    $('sheet').replaceChildren(...sheetContent(p));
  }
  // Printing from the main screen (the phone's own Print or Share > Print) prints the medication lists
  // for whoever is shown, one page each, instead of a blank page.
  window.addEventListener('beforeprint', () => {
    if (view === 'medlist' || !state.people.length) return;
    const people = filter === 'all' ? state.people : state.people.filter((p) => p.id === filter);
    $('printSheets').replaceChildren(...people.map((p) => el('article', { class: 'sheet' }, ...sheetContent(p))));
    $('printSheets').classList.add('active');
  });
  window.addEventListener('afterprint', () => { $('printSheets').classList.remove('active'); $('printSheets').replaceChildren(); });
  $('mlPerson').addEventListener('change', renderSheet);

  // ---------- tool buttons ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'medlist') { view = 'medlist'; $('mlPerson').replaceChildren(); render(); window.scrollTo(0, 0); }
    else if (act === 'back') { view = 'home'; render(); }
    else if (act === 'print') window.print();
    else if (act === 'calendarAll') addToCalendar(state.meds.filter((m) => filter === 'all' || m.personId === filter));
    else if (act === 'reload') location.reload();
    else if (act === 'backup') backup();
    else if (act === 'bringBack') {
      if (!confirm('Replace the current list with the earlier one?')) return;
      bringBackPrevious();
    }
    else if (act === 'keepNew') { forgetPrevious(); render(); }
    else if (act === 'saveUnreadable') {
      let text = unreadable;
      try { const k = JSON.parse(localStorage.getItem(UNREADABLE_KEY) || 'null'); if (k && k.text) text = k.text; } catch (err) {}
      downloadFile(`medicine-shelf-damaged-${today()}.txt`, text || '', 'text/plain');
    }
    else if (act === 'startOver') {
      if (!confirm('Start a new, empty list? The damaged copy stays saved on this phone in case it can be recovered later.')) return;
      unreadable = null; state = blank(); filter = 'all'; save(); render(); done('Started a new list.');
    }
    else if (act === 'backupKept' && state.meta.backupPending) {
      const pend = state.meta.backupPending;
      state.meta.lastBackup = pend.date;
      // Changes made after the file was saved still count toward the next reminder.
      state.meta.changesSinceBackup = Math.max(0, (state.meta.changesSinceBackup || 0) - pend.changes);
      delete state.meta.backupPending; save(); render(); done('Thanks. Your backup is noted.');
    }
    else if (act === 'backupRetry') { delete state.meta.backupPending; save(); backup(); }
    else if (act === 'backupSkip') { delete state.meta.backupPending; save(); render(); }
    else if (act === 'example') loadExample();
    else if (act === 'clearExample') clearExample();
    else if (act === 'bigtext') {
      const on = !document.documentElement.classList.contains('big');
      applyBig(on); try { localStorage.setItem(BIG, on ? '1' : '0'); } catch (err) {}
    }
    else if (act === 'erase') {
      if (!confirm('Erase every person and medicine on this device? You can bring the list back for 7 days; after that it is gone unless you saved a backup.')) return;
      keepPrevious('erase');
      state = blank(); filter = 'all'; save(); render(); done('Everything on this device was erased.', readPrevious() ? bringBackPrevious : null);
    }
  });

  // ---------- install help ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const dismissed = () => { try { return localStorage.getItem(KEY + '.installDismissed') === '1'; } catch (e) { return false; } };
  $('installDismiss').addEventListener('click', () => { $('installTip').hidden = true; try { localStorage.setItem(KEY + '.installDismissed', '1'); } catch (e) {} });
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    if (dismissed()) return;
    $('installText').textContent = 'It opens like an app, works without internet, and keeps your list safer.';
    $('installBtn').hidden = false; $('installTip').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; $('installTip').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('installTip').hidden = true; });
  if (isIOS && !standalone && !dismissed()) {
    $('installText').textContent = 'In Safari, tap the Share button, then "Add to Home Screen". This matters on iPhone: Safari can erase saved lists for websites you haven\'t opened in a while, but not for apps on your home screen.';
    $('installTip').hidden = false;
  }

  // ---------- offline ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // When a new version takes over while the app is open, say so and offer a reload
    // (not automatic, so nothing half-typed is lost). Not shown on the very first install.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('updateBanner').hidden = false; });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Check for a new version whenever the app comes back to the front.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // Refresh "days left" when the app comes back to the front on a new day.
  let lastDay = today();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && today() !== lastDay) { lastDay = today(); render(); } });

  window.__medShelf = { plan, buildIcs, get state() { return state; } };
  render();
})();
