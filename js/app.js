import * as L from './logic.js';
import { loadState, saveState, normalizeState, requestPersistence, defaultProgram } from './store.js';
import { renderLineChart } from './chart.js';
import * as audio from './audio.js';
import * as metro from './metronome.js';

export const APP_VERSION = '1.1.0';

let S; // app state (settings, program, sessions, active)
let editing = null; // deep copy of a history session being edited
const main = document.getElementById('main');

// ---------- helpers ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const unit = () => S.settings.unit;
const num = (v) => {
  const t = String(v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(S), 200);
}
function persistNow() {
  clearTimeout(saveTimer);
  if (!S) return Promise.resolve();
  return saveState(S);
}

function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, action ? 10000 : 2600);
}

function currentWeek(date = new Date()) {
  return L.cycleWeek(S.settings.cycleStart, date, S.settings.weekStartsOn);
}

const fmtW = (w) => (w == null || w === '' ? '' : `${L.fmtNum(w)} ${unit()}`);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso, withDow = true) {
  const d = new Date(iso);
  return `${withDow ? DOW[d.getDay()] + ', ' : ''}${MON[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}

function targetText(ex, t) {
  const parts = [`${t.sets} ×`];
  if (ex.trackReps) parts.push(`${t.reps}`);
  if (ex.trackTime) parts.push(L.formatDuration(t.duration));
  let s = parts.join(' ');
  if (ex.trackWeight && t.weight > 0) s += ` @ ${fmtW(t.weight)}`;
  return s;
}

function deloadText(d) {
  const bits = [];
  if (d.weightPct) bits.push(`weight −${d.weightPct}%`);
  if (d.setsPct) bits.push(`sets −${d.setsPct}%`);
  if (d.repsPct) bits.push(`reps −${d.repsPct}%`);
  if (d.durationPct) bits.push(`time −${d.durationPct}%`);
  return bits.length ? bits.join(', ') : 'no change';
}

const ICON = {
  today: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  program: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 5v4h4"/><path d="M12 8v4l3 2"/>',
  progress: '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 7-7"/><path d="M15 7h4v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

// ---------- routing ----------

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  return { tab: parts[0] || 'today', parts };
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  if (!S) return; // state still loading
  const { tab, parts } = parseRoute();
  const y = window.scrollY;
  const keepScroll = render.lastHash === location.hash;
  render.lastHash = location.hash;

  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));

  if (tab === 'program') {
    if (parts[1] === 'day' && parts[3] === 'ex') renderExerciseEditor(parts[2], parts[4]);
    else if (parts[1] === 'day') renderDay(parts[2]);
    else renderProgram();
  } else if (tab === 'history') {
    if (parts[1] && parts[2] === 'edit') renderEditSession(parts[1]);
    else if (parts[1]) renderSessionDetail(parts[1]);
    else renderHistory();
  } else if (tab === 'progress') renderProgress();
  else if (tab === 'settings') renderSettings();
  else renderToday();

  window.scrollTo(0, keepScroll ? y : 0);
  updateTimers();
}

// ============================================================
// TODAY
// ============================================================

function weekStrip(week) {
  return `<div class="week-strip" role="list" aria-label="Training cycle">
    ${[1, 2, 3, 4].map((w) => `<div role="listitem" class="wk ${w === week ? 'on' : ''} ${L.isDeloadWeek(w) ? 'deload' : ''}">
      <span>Week ${w}</span><small>${L.isDeloadWeek(w) ? 'Deload' : 'Normal'}</small></div>`).join('')}
  </div>`;
}

function renderToday() {
  if (S.active) return renderWorkout(S.active, 'active');
  const days = S.program.days;
  const week = currentWeek();
  const ui = S.ui;
  const suggested = L.nextDayId(days, S.sessions);
  const dayId = days.some((d) => d.id === ui.pickDay) ? ui.pickDay : suggested;
  const day = days.find((d) => d.id === dayId);
  const deload = ui.deloadChoice != null ? ui.deloadChoice : L.isDeloadWeek(week);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;

  main.innerHTML = `
    <header class="page-head"><h1>Today</h1><p class="sub">${esc(fmtDate(new Date().toISOString()))}</p></header>
    ${standalone ? '' : `<div class="card note-card"><strong>Install this app:</strong> in Safari tap the Share button, then <em>Add to Home Screen</em>. Open it from the Home Screen icon from then on. Your data is saved inside the installed app.</div>`}
    <section class="card">
      <div class="row-between"><h2>Week ${week} of 4</h2>${L.isDeloadWeek(week) ? '<span class="badge deload">Deload week</span>' : ''}</div>
      ${weekStrip(week)}
    </section>
    ${!days.length ? `<section class="card"><p>Your program has no workout days yet.</p><a class="btn primary block" href="#/program">Set up program</a></section>` : `
    <section class="card">
      <h2>Workout</h2>
      <div class="chips" role="radiogroup" aria-label="Workout day">
        ${days.map((d) => `<button type="button" role="radio" aria-checked="${d.id === dayId}" class="chip ${d.id === dayId ? 'on' : ''}" data-act="pick-day" data-id="${d.id}">${esc(d.name)}${d.id === suggested ? ' <small>next</small>' : ''}</button>`).join('')}
      </div>
      <label class="switch-row"><span>Deload session<small>${L.isDeloadWeek(week) ? 'On automatically in week 4' : 'Off — not a deload week'}</small></span>
        <input type="checkbox" class="switch" data-act="toggle-deload" ${deload ? 'checked' : ''}></label>
      <ul class="plan-list">
        ${day.exercises.map((ex) => {
          const t = L.plannedTargets(ex, S.settings, deload);
          const wu = L.warmupSets(ex, S.settings, t.weight).length;
          const tp = L.parseTempo(ex.tempo);
          return `<li><span>${esc(ex.name)}</span><span class="muted">${esc(targetText(ex, t))}${tp ? ` · tempo ${esc(tp.text)}` : ''}${wu ? ` · ${wu} warm-up` : ''}</span></li>`;
        }).join('') || '<li class="muted">No exercises in this day yet.</li>'}
      </ul>
      <button type="button" class="btn primary block big" data-act="start" ${day.exercises.length ? '' : 'disabled'}>Start ${esc(day.name)}</button>
    </section>`}
  `;
}

// ---------- workout (active session, or editing a past one) ----------

function setRow(ex, set, ei, si, mode) {
  const warm = set.type === 'warmup';
  const n = ex.sets.slice(0, si + 1).filter((s) => s.type === set.type).length;
  const label = warm ? `W${n}` : String(n);
  const cells = [];
  if (ex.trackWeight) cells.push(`<input class="num" type="text" inputmode="decimal" data-f="weight" value="${esc(L.fmtNum(set.weight))}" aria-label="Weight set ${label}">`);
  if (ex.trackReps) cells.push(`<input class="num" type="text" inputmode="numeric" data-f="reps" value="${esc(set.reps ?? '')}" aria-label="Reps set ${label}">`);
  if (ex.trackTime) {
    cells.push(`<div class="time-cell"><input class="num" type="text" inputmode="numeric" data-f="duration" value="${esc(set.duration ?? '')}" aria-label="Seconds set ${label}">${mode === 'active' ? `<button type="button" class="icon-btn play" data-act="countdown" aria-label="Start timer">▶</button>` : ''}</div>`);
  }
  return `<div class="set-row ${warm ? 'warm' : ''} ${set.done ? 'done' : ''}" data-ei="${ei}" data-si="${si}">
    <span class="set-label">${label}${warm && set.pct ? `<small>${set.pct}%</small>` : ''}</span>
    ${cells.join('')}
    <button type="button" class="check" data-act="toggle-set" aria-pressed="${set.done}" aria-label="Set ${label} done">✓</button>
  </div>`;
}

function exerciseCard(session, ex, ei, mode) {
  const cols = [ex.trackWeight, ex.trackReps, ex.trackTime].filter(Boolean).length;
  const last = L.lastPerformance(S.sessions, ex.name, session.id);
  const lastHtml = last
    ? `<div class="last"><span class="muted">Last time · ${esc(fmtDate(last.session.startedAt, false))}${last.session.deload ? ' (deload)' : ''}:</span> ${esc(L.summarizeSets(last.exercise, unit()) || '—')}
        ${last.exercise.notes ? `<div class="last-note">“${esc(last.exercise.notes)}”</div>` : ''}</div>`
    : '';
  const heads = ['<span>Set</span>'];
  if (ex.trackWeight) heads.push(`<span>${esc(unit())}</span>`);
  if (ex.trackReps) heads.push('<span>Reps</span>');
  if (ex.trackTime) heads.push('<span>Sec</span>');
  heads.push('<span></span>');
  const doneCount = ex.sets.filter((s) => s.done).length;
  return `<section class="card ex-card" data-ei="${ei}">
    <div class="row-between"><h2>${esc(ex.name)}</h2><span class="muted small">${doneCount}/${ex.sets.length} · rest ${L.formatDuration(ex.restSec)}</span></div>
    ${ex.tempo || mode === 'active' ? `<div class="tempo-row">
      ${ex.tempo ? `<span class="tempo-chip" title="${esc(L.describeTempo(ex.tempo))}">Tempo <strong>${esc(ex.tempo)}</strong></span>` : ''}
      ${mode === 'active' ? `<button type="button" class="btn small metro-btn" data-act="metro-for" data-ei="${ei}">♩ Metronome</button>` : ''}
    </div>` : ''}
    ${lastHtml}
    <div class="sets" style="--cols:${cols}">
      <div class="set-row head">${heads.join('')}</div>
      ${ex.sets.map((s, si) => setRow(ex, s, ei, si, mode)).join('')}
    </div>
    <div class="row-gap">
      <button type="button" class="btn small" data-act="add-set" data-ei="${ei}">+ Add set</button>
      <button type="button" class="btn small ghost" data-act="remove-set" data-ei="${ei}" ${ex.sets.length ? '' : 'disabled'}>− Remove last</button>
    </div>
    <textarea class="notes" data-f="ex-notes" data-ei="${ei}" rows="2" placeholder="Notes on this exercise (form, how it felt…)">${esc(ex.notes)}</textarea>
  </section>`;
}

function renderWorkout(session, mode) {
  const allNames = [...new Set(S.program.days.flatMap((d) => d.exercises.map((e) => e.name)))];
  main.innerHTML = `
    <header class="page-head workout-head">
      ${mode === 'edit' ? `<a class="back" href="#/history/${session.id}">‹ Cancel</a>` : ''}
      <h1>${esc(session.dayName)}</h1>
      <p class="sub">${mode === 'edit' ? 'Editing · ' + esc(fmtDate(session.startedAt)) + ' · ' : ''}Week ${session.week}
        ${session.deload ? '<span class="badge deload">Deload</span>' : ''}
        ${mode === 'active' ? '· <span id="elapsed"></span>' : ''}</p>
      ${mode === 'active' ? '<button type="button" class="btn small metro-btn head-metro" data-act="metro-for" data-ei="-1">♩ Metronome</button>' : ''}
    </header>
    ${session.exercises.map((ex, ei) => exerciseCard(session, ex, ei, mode)).join('')}
    <section class="card">
      <label class="field-label" for="add-ex">Add an exercise to this session</label>
      <div class="row-gap">
        <select id="add-ex" class="grow"><option value="">Choose…</option>${allNames.map((n) => `<option>${esc(n)}</option>`).join('')}<option value="__custom">Other (type a name)…</option></select>
        <button type="button" class="btn small" data-act="add-exercise">Add</button>
      </div>
    </section>
    <section class="card">
      <label class="field-label" for="session-notes">Session notes</label>
      <textarea id="session-notes" class="notes" data-f="session-notes" rows="3" placeholder="Energy, sleep, anything about today's workout…">${esc(session.notes)}</textarea>
    </section>
    <div class="actions">
      ${mode === 'active'
        ? `<button type="button" class="btn primary block big" data-act="finish">Finish workout</button>
           <button type="button" class="btn danger-ghost block" data-act="discard">Discard workout</button>`
        : `<button type="button" class="btn primary block big" data-act="save-edit">Save changes</button>`}
    </div>`;
}

function workoutSession() {
  return parseRoute().tab === 'history' ? editing : S.active;
}

function sessionChanged() {
  if (workoutSession() === S.active) persist();
}

// ---------- starting / finishing ----------

function startWorkout() {
  const days = S.program.days;
  const week = currentWeek();
  const dayId = days.some((d) => d.id === S.ui.pickDay) ? S.ui.pickDay : L.nextDayId(days, S.sessions);
  const day = days.find((d) => d.id === dayId);
  if (!day) return;
  const deload = S.ui.deloadChoice != null ? S.ui.deloadChoice : L.isDeloadWeek(week);
  S.active = L.buildSession(day, S.settings, { week, deload });
  S.ui = {};
  persistNow();
  wakeLock.update();
  render();
}

function stripUndone(session) {
  for (const ex of session.exercises) ex.sets = ex.sets.filter((s) => s.done);
  session.exercises = session.exercises.filter((ex) => ex.sets.length || ex.notes.trim());
}

function finishWorkout() {
  const s = S.active;
  const all = s.exercises.flatMap((e) => e.sets);
  const done = all.filter((x) => x.done).length;
  if (!done && !confirm('No sets are ticked off. Save this workout anyway?')) return;
  if (done && done < all.length && !confirm(`${all.length - done} set(s) were not ticked off and won't be saved. Finish workout?`)) return;
  stripUndone(s);
  s.finishedAt = new Date().toISOString();
  delete s.rest;
  delete s.timer;
  S.sessions.push(s);
  S.active = null;
  closeMetro();
  persistNow();
  wakeLock.update();
  hideOverlays();
  toast('Workout saved');
  go(`#/history/${s.id}`);
}

function addExerciseToSession(session) {
  const sel = document.getElementById('add-ex');
  let name = sel.value;
  if (!name) return;
  let template = S.program.days.flatMap((d) => d.exercises).find((e) => L.normName(e.name) === L.normName(name));
  if (name === '__custom') {
    name = (prompt('Exercise name') || '').trim();
    if (!name) return;
    template = null;
  }
  const ex = template || {
    id: L.uid(), name, trackWeight: true, trackReps: true, trackTime: false,
    sets: 3, reps: 8, weight: 0, duration: 0, restSec: 90, warmup: { mode: 'off' }, deloadOverride: null,
  };
  session.exercises.push(L.buildSessionExercise(ex, S.settings, session.deload));
  sessionChanged();
  render();
}

// ---------- rest timer & countdown ----------

function startRest(sec) {
  if (!S.active || !(sec > 0)) return;
  S.active.rest = { endsAt: Date.now() + sec * 1000, total: sec, beeped: -1 };
  persist();
  updateTimers();
}

function timerElapsed(t, now = Date.now()) {
  return t.acc + (t.since ? now - t.since : 0);
}

function startCountdown(ei, si) {
  const set = S.active.exercises[ei].sets[si];
  const total = Math.round(num(set.duration) || 0);
  S.active.rest = null;
  S.active.timer = { ei, si, total, acc: 0, since: null, lead: Date.now() + 3000, beeped: -1 };
  persist();
  updateTimers();
}

function completeCountdown(seconds) {
  const s = S.active;
  const t = s.timer;
  const ex = s.exercises[t.ei];
  const set = ex.sets[t.si];
  set.duration = seconds;
  set.done = true;
  s.timer = null;
  audio.done(S.settings.sound);
  startRest(set.restSec);
  persist();
  render();
}

function hideOverlays() {
  document.getElementById('restbar').hidden = true;
  document.getElementById('countdown').hidden = true;
  document.body.classList.remove('has-restbar');
}

function updateTimers() {
  const s = S && S.active;
  const now = Date.now();
  const elapsedEl = document.getElementById('elapsed');
  if (elapsedEl && s) elapsedEl.textContent = `${Math.floor((now - new Date(s.startedAt)) / 60000)} min`;

  // Countdown overlay
  const cd = document.getElementById('countdown');
  if (s && s.timer) {
    const t = s.timer;
    const ex = s.exercises[t.ei];
    if (!ex || !ex.sets[t.si]) { s.timer = null; return updateTimers(); }
    if (t.lead) {
      const left = Math.ceil((t.lead - now) / 1000);
      if (left <= 0) {
        t.lead = null;
        t.since = now;
        audio.go(S.settings.sound);
      } else if (left !== t.beeped) {
        t.beeped = left;
        audio.tick(S.settings.sound);
      }
    }
    const el = timerElapsed(t, now);
    if (!t.lead && t.total > 0 && el >= t.total * 1000) return completeCountdown(t.total);
    const n = ex.sets.slice(0, t.si + 1).filter((x) => x.type === ex.sets[t.si].type).length;
    cd.hidden = false;
    cd.querySelector('.cd-title').textContent = `${ex.name} · set ${n}`;
    let big;
    let sub;
    if (t.lead) {
      big = String(Math.ceil((t.lead - now) / 1000));
      sub = 'Get ready';
    } else if (t.total > 0) {
      const remain = Math.ceil((t.total * 1000 - el) / 1000);
      big = L.formatDuration(remain);
      sub = t.since ? `of ${L.formatDuration(t.total)}` : 'Paused';
      if (t.since && remain <= 3 && remain !== t.beeped) { t.beeped = remain; audio.tick(S.settings.sound); }
    } else {
      big = L.formatDuration(Math.floor(el / 1000));
      sub = t.since ? 'Stopwatch — tap Done when finished' : 'Paused';
    }
    cd.querySelector('.cd-time').textContent = big;
    cd.querySelector('.cd-sub').textContent = sub;
    const pct = t.total > 0 && !t.lead ? Math.min(100, (el / (t.total * 1000)) * 100) : 0;
    cd.querySelector('.cd-progress span').style.width = pct + '%';
    cd.querySelector('[data-act="cd-pause"]').textContent = t.since || t.lead ? 'Pause' : 'Resume';
  } else {
    cd.hidden = true;
  }

  // Rest bar
  const bar = document.getElementById('restbar');
  if (s && s.rest) {
    const r = s.rest;
    const remain = Math.ceil((r.endsAt - now) / 1000);
    if (remain <= 0) {
      s.rest = null;
      persist();
      audio.restOver(S.settings.sound);
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
      bar.hidden = true;
      document.body.classList.remove('has-restbar');
      toast('Rest over — next set!');
      return;
    }
    if (remain <= 3 && remain !== r.beeped) { r.beeped = remain; audio.tick(S.settings.sound); }
    bar.hidden = false;
    document.body.classList.add('has-restbar');
    bar.querySelector('.rest-time').textContent = L.formatDuration(remain);
    bar.querySelector('.rest-progress span').style.width = `${Math.max(0, Math.min(100, (remain / r.total) * 100))}%`;
  } else {
    bar.hidden = true;
    document.body.classList.remove('has-restbar');
  }
}

// Keep the screen on during a workout (supported on recent iOS).
const wakeLock = {
  lock: null,
  async update() {
    const want = S.active && S.settings.keepAwake && document.visibilityState === 'visible';
    try {
      if (want && !this.lock && 'wakeLock' in navigator) {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      } else if (!want && this.lock) {
        await this.lock.release();
        this.lock = null;
      }
    } catch { this.lock = null; }
  },
};

// ============================================================
// METRONOME
// ============================================================

const metroUI = { ei: -1, mode: 'beat', tempo: '', bpm: 60, stopAfter: true, targetReps: 0, lastRep: 0, doneAt: 0, message: '' };

// Reps of the next working set that isn't ticked off yet.
function nextTargetReps(ex) {
  if (!ex || !ex.trackReps) return 0;
  const set = ex.sets.find((x) => x.type === 'working' && !x.done) || ex.sets.filter((x) => x.type === 'working').pop();
  return set && set.reps > 0 ? set.reps : 0;
}

function openMetro(ei) {
  const ex = S.active && ei >= 0 ? S.active.exercises[ei] : null;
  if (!metro.isRunning()) {
    metroUI.ei = ex ? ei : -1;
    metroUI.tempo = ex ? ex.tempo || '' : '';
    metroUI.mode = ex && L.parseTempo(ex.tempo) ? 'tempo' : 'beat';
    metroUI.bpm = S.settings.metroBpm || 60;
    metroUI.targetReps = nextTargetReps(ex);
    metroUI.message = '';
  }
  document.getElementById('metro').hidden = false;
  renderMetro();
}

function closeMetro() {
  metro.stop();
  document.getElementById('metro').hidden = true;
  document.getElementById('metro-pill').hidden = true;
}

function metroTitle() {
  const ex = S.active && metroUI.ei >= 0 ? S.active.exercises[metroUI.ei] : null;
  return ex ? ex.name : 'Metronome';
}

function renderMetro() {
  const box = document.getElementById('metro-box');
  const running = metro.isRunning();
  const tp = L.parseTempo(metroUI.tempo);
  const lead = S.settings.metroLeadIn;
  box.innerHTML = `
    <p class="cd-title">${esc(metroTitle())}</p>
    <div class="segmented ${running ? 'locked' : ''}">
      <button type="button" class="${metroUI.mode === 'tempo' ? 'on' : ''}" data-act="metro-mode" data-m="tempo" ${running ? 'disabled' : ''}>Tempo</button>
      <button type="button" class="${metroUI.mode === 'beat' ? 'on' : ''}" data-act="metro-mode" data-m="beat" ${running ? 'disabled' : ''}>Steady beat</button>
    </div>
    ${metroUI.mode === 'tempo' ? `
      <label class="field"><span>Tempo</span><input class="tempo-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" data-metro="tempo" value="${esc(metroUI.tempo)}" placeholder="3-1-2-0" ${running ? 'disabled' : ''} aria-label="Tempo"></label>
      <p class="muted small left" id="metro-tempo-help">${esc(tempoHelp(metroUI.tempo))}</p>
      ${metroUI.targetReps ? `<label class="switch-row"><span>Stop after ${metroUI.targetReps} reps</span><input type="checkbox" class="switch" data-act="metro-stopafter" ${metroUI.stopAfter ? 'checked' : ''} ${running ? 'disabled' : ''}></label>` : ''}`
    : `
      <div class="bpm-row">
        <button type="button" class="icon-btn big-icon" data-act="metro-bpm" data-d="-5" ${running ? 'disabled' : ''} aria-label="Slower">−</button>
        <label><input class="num bpm-input" type="text" inputmode="numeric" data-metro="bpm" value="${metroUI.bpm}" ${running ? 'disabled' : ''} aria-label="Beats per minute"><span>BPM</span></label>
        <button type="button" class="icon-btn big-icon" data-act="metro-bpm" data-d="5" ${running ? 'disabled' : ''} aria-label="Faster">+</button>
      </div>`}
    <div class="metro-display" id="metro-display">
      <p class="metro-big">${running ? '' : metroUI.message ? '✓' : 'Ready'}</p>
      <p class="cd-sub">${running ? '' : esc(metroUI.message || (lead ? `Starts ${lead}s after you tap Start` : 'Starts as soon as you tap Start'))}</p>
      <div class="cd-progress"><span></span></div>
    </div>
    <div class="cd-actions">
      ${running
        ? '<button type="button" class="btn big" data-act="metro-hide">Hide</button><button type="button" class="btn primary big stop" data-act="metro-stop">Stop</button>'
        : `<button type="button" class="btn big" data-act="metro-hide">Close</button><button type="button" class="btn primary big" data-act="metro-start" ${metroUI.mode === 'tempo' && !tp ? 'disabled' : ''}>Start</button>`}
    </div>`;
  updateMetro();
}

function startMetro() {
  const tp = L.parseTempo(metroUI.tempo);
  if (metroUI.mode === 'tempo' && !tp) return;
  // Prime speech on this tap: iOS only allows it after a user gesture.
  if (S.settings.metroSpeak && window.speechSynthesis) {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}
  }
  const ok = metro.start({
    mode: metroUI.mode,
    secs: tp ? tp.secs : null,
    bpm: metroUI.bpm,
    leadIn: S.settings.metroLeadIn,
    targetReps: metroUI.mode === 'tempo' && metroUI.stopAfter ? metroUI.targetReps : 0,
  });
  if (!ok) return toast('Sound is not available on this device');
  metroUI.lastRep = 0;
  metroUI.doneAt = 0;
  metroUI.message = '';
  renderMetro();
}

function stopMetro(message) {
  metro.stop();
  metroUI.message = message || '';
  if (!document.getElementById('metro').hidden) renderMetro();
  updateMetro();
}

function speakRep(n) {
  if (!S.settings.metroSpeak || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(n));
    u.rate = 1.2;
    speechSynthesis.speak(u);
  } catch {}
}

function updateMetro() {
  const sheet = document.getElementById('metro');
  const pill = document.getElementById('metro-pill');
  if (!sheet || !S) return;
  const stt = metro.status();
  pill.hidden = !(stt && sheet.hidden);
  if (!stt) return;

  let big = '';
  let sub = '';
  let pct = 0;
  let phaseClass = '';
  if (stt.stage === 'lead') {
    big = String(stt.leadRemaining);
    sub = 'Get in position…';
  } else if (stt.stage === 'done') {
    if (!metroUI.doneAt) { metroUI.doneAt = Date.now(); speakRep(stt.rep); }
    big = '✓';
    sub = `${stt.rep} reps done`;
    pct = 100;
    if (Date.now() - metroUI.doneAt > 1500) return stopMetro(`${stt.rep} reps done`);
  } else if (stt.mode === 'beat') {
    big = String(((stt.beat - 1) % 4) + 1);
    sub = `${stt.bpm} BPM · beat ${stt.beat}`;
  } else {
    if (stt.rep > metroUI.lastRep) { metroUI.lastRep = stt.rep; speakRep(stt.rep); }
    big = L.TEMPO_PHASES[stt.phase];
    phaseClass = ['lower', 'pause', 'lift', 'pause'][stt.phase];
    const rep = stt.rep + 1;
    sub = `${Math.ceil(stt.phaseRemaining)}s · rep ${stt.targetReps ? `${Math.min(rep, stt.targetReps)} of ${stt.targetReps}` : rep}`;
    pct = stt.phaseLength ? (stt.phaseElapsed / stt.phaseLength) * 100 : 0;
  }

  const disp = document.getElementById('metro-display');
  if (disp && !sheet.hidden) {
    const b = disp.querySelector('.metro-big');
    b.textContent = big;
    b.className = 'metro-big ' + phaseClass;
    disp.querySelector('.cd-sub').textContent = sub;
    disp.querySelector('.cd-progress span').style.width = `${Math.min(100, pct)}%`;
  }
  pill.querySelector('span').textContent = stt.stage === 'lead' ? `Starting in ${big}` : stt.mode === 'tempo' && stt.stage === 'run' ? `${big} · ${sub}` : sub;
}

// ============================================================
// PROGRAM
// ============================================================

function renderProgram() {
  const week = currentWeek();
  main.innerHTML = `
    <header class="page-head"><h1>Program</h1><p class="sub">Workout days rotate in this order, then repeat.</p></header>
    <section class="card">
      <h2>4-week cycle</h2>
      <label class="field"><span>Current week</span>
        <select data-act="set-week">${[1, 2, 3, 4].map((w) => `<option value="${w}" ${w === week ? 'selected' : ''}>Week ${w}${L.isDeloadWeek(w) ? ' (deload)' : ''}</option>`).join('')}</select></label>
      <p class="muted small">Weeks 1–3 use your normal numbers. Week 4 is a deload (${esc(deloadText(S.settings.deload))}; change it in Settings). After week 4 the cycle starts again at week 1 automatically.</p>
    </section>
    <section class="card">
      <h2>Workout days</h2>
      <ul class="list">
        ${S.program.days.map((d, i) => `<li class="list-row">
          <a href="#/program/day/${d.id}" class="grow"><strong>${i + 1}. ${esc(d.name)}</strong><span class="muted small">${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}</span></a>
          <button type="button" class="icon-btn" data-act="day-up" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
          <button type="button" class="icon-btn" data-act="day-down" data-i="${i}" aria-label="Move down" ${i < S.program.days.length - 1 ? '' : 'disabled'}>↓</button>
        </li>`).join('') || '<li class="muted">No days yet.</li>'}
      </ul>
      <button type="button" class="btn block" data-act="add-day">+ Add workout day</button>
    </section>`;
}

function findDay(id) {
  return S.program.days.find((d) => d.id === id);
}

function renderDay(dayId) {
  const day = findDay(dayId);
  if (!day) return go('#/program');
  main.innerHTML = `
    <header class="page-head"><a class="back" href="#/program">‹ Program</a>
      <input class="title-input" data-f="day-name" value="${esc(day.name)}" aria-label="Day name"></header>
    <section class="card">
      <ul class="list">
        ${day.exercises.map((ex, i) => `<li class="list-row">
          <a href="#/program/day/${day.id}/ex/${ex.id}" class="grow"><strong>${esc(ex.name)}</strong>
            <span class="muted small">${esc(targetText(ex, L.plannedTargets(ex, S.settings, false)))} · rest ${L.formatDuration(ex.restSec)}</span></a>
          <button type="button" class="icon-btn" data-act="ex-up" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
          <button type="button" class="icon-btn" data-act="ex-down" data-i="${i}" aria-label="Move down" ${i < day.exercises.length - 1 ? '' : 'disabled'}>↓</button>
        </li>`).join('') || '<li class="muted">No exercises yet.</li>'}
      </ul>
      <button type="button" class="btn block" data-act="add-ex">+ Add exercise</button>
    </section>
    <button type="button" class="btn danger-ghost block" data-act="delete-day">Delete “${esc(day.name)}”</button>`;
}

function schemeEditor(scheme, scope) {
  return `<div class="scheme">
    ${scheme.length ? '<div class="scheme-head"><span>Set</span><span>% of working weight</span><span>Reps</span></div>' : ''}
    ${scheme.map((s, i) => `<div class="scheme-row">
      <span class="set-label">W${i + 1}</span>
      <label><input class="num" type="text" inputmode="decimal" data-f="${scope}-pct" data-i="${i}" value="${esc(s.pct)}" aria-label="Warm-up ${i + 1} percent"> %</label>
      <label>× <input class="num" type="text" inputmode="numeric" data-f="${scope}-reps" data-i="${i}" value="${esc(s.reps)}" aria-label="Warm-up ${i + 1} reps"></label>
      <button type="button" class="icon-btn" data-act="${scope}-del" data-i="${i}" aria-label="Remove warm-up set">×</button>
    </div>`).join('')}
    <button type="button" class="btn small" data-act="${scope}-add">+ Add warm-up set</button>
  </div>`;
}

function exPreview(ex) {
  const n = L.plannedTargets(ex, S.settings, false);
  const d = L.plannedTargets(ex, S.settings, true);
  const wu = L.warmupSets(ex, S.settings, n.weight);
  return `<div><span class="muted">Normal weeks:</span> ${esc(targetText(ex, n))}</div>
    <div><span class="muted">Deload week:</span> ${esc(targetText(ex, d))}</div>
    ${wu.length ? `<div><span class="muted">Warm-ups:</span> ${wu.map((w) => `${esc(L.fmtNum(w.weight))}×${w.reps}`).join(', ')}</div>` : ''}
    ${L.parseTempo(ex.tempo) ? `<div><span class="muted">Tempo:</span> ${esc(L.parseTempo(ex.tempo).text)}</div>` : ''}`;
}

function tempoHelp(t) {
  if (!String(t || '').trim()) return 'No tempo set.';
  return L.parseTempo(t) ? L.describeTempo(t) : 'Not a valid tempo yet — use four numbers like 3-1-2-0.';
}

function renderExerciseEditor(dayId, exId) {
  const day = findDay(dayId);
  const ex = day && day.exercises.find((e) => e.id === exId);
  if (!ex) return go(day ? `#/program/day/${dayId}` : '#/program');
  const wmode = ex.warmup?.mode || 'default';
  const dl = ex.deloadOverride;
  const field = (f, label, val, mode = 'numeric', suffix = '') =>
    `<label class="field"><span>${label}</span><span class="input-wrap"><input class="num" type="text" inputmode="${mode}" data-f="${f}" value="${esc(val)}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`;
  main.innerHTML = `
    <header class="page-head"><a class="back" href="#/program/day/${day.id}">‹ ${esc(day.name)}</a>
      <input class="title-input" data-f="ex-name" value="${esc(ex.name)}" aria-label="Exercise name"></header>
    <section class="card preview" id="ex-preview">${exPreview(ex)}</section>
    <section class="card">
      <h2>What to record</h2>
      <div class="chips">
        ${[['trackWeight', 'Weight'], ['trackReps', 'Reps'], ['trackTime', 'Time']].map(([k, l]) =>
          `<label class="chip check-chip ${ex[k] ? 'on' : ''}"><input type="checkbox" data-act="track" data-k="${k}" ${ex[k] ? 'checked' : ''}>${l}</label>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Working sets</h2>
      ${field('sets', 'Sets', ex.sets)}
      ${ex.trackReps ? field('reps', 'Reps', ex.reps) : ''}
      ${ex.trackWeight ? field('weight', 'Weight', L.fmtNum(ex.weight), 'decimal', esc(unit())) : ''}
      ${ex.trackTime ? field('duration', 'Time per set', ex.duration, 'numeric', 'sec') : ''}
      ${field('restSec', 'Rest between sets', ex.restSec, 'numeric', 'sec')}
      <div class="chips small-chips">${[30, 45, 60, 90, 120, 180, 240].map((s) => `<button type="button" class="chip ${ex.restSec === s ? 'on' : ''}" data-act="rest-preset" data-s="${s}">${L.formatDuration(s)}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h2>Tempo</h2>
      <label class="field"><span>Tempo <small class="muted">(optional)</small></span>
        <input class="tempo-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" data-f="tempo" value="${esc(ex.tempo || '')}" placeholder="3-1-2-0" aria-label="Tempo"></label>
      <p class="muted small" id="tempo-help">${esc(tempoHelp(ex.tempo))}</p>
      <p class="muted small">Seconds to lower – pause at the bottom – lift – pause at the top. Use X for explosive. Stays the same in deload weeks.</p>
    </section>
    ${ex.trackWeight ? `<section class="card">
      <h2>Warm-up sets</h2>
      <div class="segmented">
        ${[['default', 'Default'], ['custom', 'Custom'], ['off', 'Off']].map(([m, l]) => `<button type="button" class="${wmode === m ? 'on' : ''}" data-act="warm-mode" data-m="${m}">${l}</button>`).join('')}
      </div>
      ${wmode === 'default' ? `<p class="muted small">Uses the default scheme from Settings: ${S.settings.warmupScheme.map((s) => `${s.pct}%×${s.reps}`).join(', ') || 'none'}.</p>` : ''}
      ${wmode === 'custom' ? schemeEditor(ex.warmup.scheme || [], 'exwu') : ''}
      ${wmode === 'off' ? '<p class="muted small">No warm-up sets for this exercise.</p>' : ''}
    </section>` : ''}
    <section class="card">
      <h2>Deload week</h2>
      <div class="segmented">
        <button type="button" class="${dl ? '' : 'on'}" data-act="deload-mode" data-m="global">Use default</button>
        <button type="button" class="${dl ? 'on' : ''}" data-act="deload-mode" data-m="custom">Custom</button>
      </div>
      ${dl ? `
        ${field('dl-weightPct', 'Reduce weight by', dl.weightPct, 'numeric', '%')}
        ${field('dl-setsPct', 'Reduce sets by', dl.setsPct, 'numeric', '%')}
        ${field('dl-repsPct', 'Reduce reps by', dl.repsPct, 'numeric', '%')}
        ${field('dl-durationPct', 'Reduce time by', dl.durationPct, 'numeric', '%')}`
        : `<p class="muted small">Default: ${esc(deloadText(S.settings.deload))}.</p>`}
    </section>
    <button type="button" class="btn danger-ghost block" data-act="delete-ex">Delete exercise</button>`;
}

// ============================================================
// HISTORY
// ============================================================

function sessionStats(s) {
  const sets = s.exercises.flatMap((e) => e.sets.filter((x) => x.done && x.type === 'working'));
  const mins = s.finishedAt ? Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 60000) : null;
  return { sets: sets.length, mins };
}

function renderHistory() {
  const sorted = [...S.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  main.innerHTML = `
    <header class="page-head"><h1>History</h1><p class="sub">${sorted.length} workout${sorted.length === 1 ? '' : 's'} logged</p></header>
    <section class="card">
      <div class="row-gap">
        <button type="button" class="btn grow" data-act="export-csv" ${sorted.length ? '' : 'disabled'}>Export CSV</button>
        <button type="button" class="btn grow" data-act="export-backup">Back up</button>
      </div>
      <p class="muted small">CSV opens in Google Sheets. A backup file can restore everything in Settings.</p>
    </section>
    <ul class="list card">
      ${sorted.map((s) => {
        const st = sessionStats(s);
        return `<li class="list-row"><a class="grow" href="#/history/${s.id}">
          <strong>${esc(fmtDate(s.startedAt))} · ${esc(s.dayName)}</strong>
          <span class="muted small">Week ${s.week}${s.deload ? ' · deload' : ''} · ${st.sets} working sets${st.mins != null ? ` · ${st.mins} min` : ''}</span></a>
          ${s.deload ? '<span class="badge deload">D</span>' : ''}<span class="chev">›</span></li>`;
      }).join('') || '<li class="muted">No workouts yet. Finish a workout and it will show up here.</li>'}
    </ul>`;
}

function renderSessionDetail(id) {
  const s = S.sessions.find((x) => x.id === id);
  if (!s) return go('#/history');
  const st = sessionStats(s);
  main.innerHTML = `
    <header class="page-head"><a class="back" href="#/history">‹ History</a>
      <h1>${esc(s.dayName)}</h1>
      <p class="sub">${esc(fmtDate(s.startedAt))} · ${L.localTime(s.startedAt)} · Week ${s.week} ${s.deload ? '<span class="badge deload">Deload</span>' : ''}${st.mins != null ? ` · ${st.mins} min` : ''}</p></header>
    ${s.notes ? `<section class="card"><h2>Session notes</h2><p class="pre">${esc(s.notes)}</p></section>` : ''}
    ${s.exercises.map((ex) => {
      let w = 0;
      let k = 0;
      return `<section class="card"><h2>${esc(ex.name)}</h2>
        ${ex.tempo ? `<p class="muted small tempo-line">Tempo ${esc(ex.tempo)}</p>` : ''}
        <table class="log"><thead><tr><th>Set</th>${ex.trackWeight ? `<th>${esc(unit())}</th>` : ''}${ex.trackReps ? '<th>Reps</th>' : ''}${ex.trackTime ? '<th>Time</th>' : ''}</tr></thead><tbody>
        ${ex.sets.filter((x) => x.done).map((x) => `<tr class="${x.type === 'warmup' ? 'warm' : ''}"><td>${x.type === 'warmup' ? `W${++w}` : ++k}</td>
          ${ex.trackWeight ? `<td>${esc(L.fmtNum(x.weight))}</td>` : ''}${ex.trackReps ? `<td>${esc(x.reps ?? '')}</td>` : ''}${ex.trackTime ? `<td>${L.formatDuration(x.duration)}</td>` : ''}</tr>`).join('')}
        </tbody></table>
        ${ex.notes ? `<p class="pre note">${esc(ex.notes)}</p>` : ''}</section>`;
    }).join('')}
    <div class="actions">
      <a class="btn block" href="#/history/${s.id}/edit">Edit workout</a>
      <button type="button" class="btn danger-ghost block" data-act="delete-session" data-id="${s.id}">Delete workout</button>
    </div>`;
}

function renderEditSession(id) {
  if (!editing || editing.id !== id) {
    const s = S.sessions.find((x) => x.id === id);
    if (!s) return go('#/history');
    editing = clone(s);
  }
  renderWorkout(editing, 'edit');
}

// ============================================================
// PROGRESS
// ============================================================

function exerciseIndex() {
  // name -> latest tracking flags, from history first, then program
  const map = new Map();
  const add = (e) => {
    const k = L.normName(e.name);
    if (!map.has(k)) map.set(k, { name: e.name, trackWeight: e.trackWeight, trackReps: e.trackReps, trackTime: e.trackTime, count: 0 });
    return map.get(k);
  };
  [...S.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).forEach((s) => s.exercises.forEach((e) => { add(e).count++; }));
  S.program.days.forEach((d) => d.exercises.forEach(add));
  return [...map.values()];
}

function metricFormat(metric) {
  if (metric === 'maxDuration' || metric === 'totalDuration') return (v) => L.formatDuration(v);
  if (metric === 'maxReps' || metric === 'totalReps') return (v) => String(Math.round(v));
  return (v) => `${L.fmtNum(v)}`;
}

function renderProgress() {
  const list = exerciseIndex();
  const withData = list.filter((e) => e.count);
  const ui = S.ui;
  const sel = list.find((e) => L.normName(e.name) === L.normName(ui.progEx)) || withData[0] || list[0];
  if (!sel) {
    main.innerHTML = '<header class="page-head"><h1>Progress</h1></header><section class="card"><p class="muted">Nothing to chart yet.</p></section>';
    return;
  }
  const metrics = Object.entries(L.METRICS).filter(([, m]) => m.needs.every((k) => sel[k]));
  const metric = metrics.some(([k]) => k === ui.progMetric) ? ui.progMetric : metrics[0]?.[0];
  const hideDeload = !!ui.progHideDeload;
  const points = (metric ? L.progressSeries(S.sessions, sel.name, metric) : []).filter((p) => !(hideDeload && p.deload));
  const fmt = metricFormat(metric);
  const isWeight = ['topWeight', 'e1rm', 'volume'].includes(metric);
  const withUnit = (v) => (isWeight ? `${fmt(v)} ${unit()}` : fmt(v));
  const best = points.length ? Math.max(...points.map((p) => p.value)) : null;
  const latest = points.length ? points[points.length - 1].value : null;
  const first = points.length ? points[0].value : null;
  const change = points.length > 1 ? latest - first : null;

  main.innerHTML = `
    <header class="page-head"><h1>Progress</h1></header>
    <section class="card">
      <label class="field"><span>Exercise</span><select data-act="prog-ex">
        ${list.map((e) => `<option value="${esc(e.name)}" ${e === sel ? 'selected' : ''}>${esc(e.name)}${e.count ? '' : ' (no data)'}</option>`).join('')}</select></label>
      <label class="field"><span>Measure</span><select data-act="prog-metric">
        ${metrics.map(([k, m]) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label class="switch-row"><span>Include deload weeks</span><input type="checkbox" class="switch" data-act="prog-deload" ${hideDeload ? '' : 'checked'}></label>
    </section>
    ${points.length ? `
    <section class="tiles">
      <div class="tile"><span>Latest</span><strong>${esc(withUnit(latest))}</strong></div>
      <div class="tile"><span>Best</span><strong>${esc(withUnit(best))}</strong></div>
      <div class="tile"><span>Change</span><strong>${change == null ? '—' : esc((change > 0 ? '+' : change < 0 ? '−' : '') + withUnit(Math.abs(change)))}</strong></div>
    </section>
    <section class="card">
      <h2>${esc(L.METRICS[metric].label)}${isWeight ? ` <span class="muted small">(${esc(unit())})</span>` : ''}</h2>
      <div class="chart-wrap" id="chart"></div>
      <p class="muted small legend"><span class="key-dot"></span> normal week <span class="key-dot hollow"></span> deload week · ${metric === 'e1rm' ? 'Epley formula from your best working set.' : 'Working sets only (warm-ups excluded).'}</p>
    </section>
    <section class="card">
      <h2>Entries</h2>
      <table class="log"><thead><tr><th>Date</th><th>Value</th><th></th></tr></thead><tbody>
        ${[...points].reverse().map((p) => `<tr><td><a href="#/history/${p.sessionId}">${esc(fmtDate(p.date, false))}</a></td><td>${esc(withUnit(p.value))}</td><td>${p.deload ? '<span class="badge deload">Deload</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
    </section>` : `<section class="card"><p class="muted">No logged sets for ${esc(sel.name)} yet.</p></section>`}`;
  if (points.length) renderLineChart(document.getElementById('chart'), points, { format: fmt });
}

// ============================================================
// SETTINGS
// ============================================================

function renderSettings() {
  const st = S.settings;
  const d = st.deload;
  const field = (f, label, val, mode = 'numeric', suffix = '') =>
    `<label class="field"><span>${label}</span><span class="input-wrap"><input class="num" type="text" inputmode="${mode}" data-f="${f}" value="${esc(val)}">${suffix ? `<em>${suffix}</em>` : ''}</span></label>`;
  main.innerHTML = `
    <header class="page-head"><h1>Settings</h1></header>
    <section class="card">
      <h2>Units</h2>
      <div class="segmented">${['lb', 'kg'].map((u) => `<button type="button" class="${st.unit === u ? 'on' : ''}" data-act="unit" data-u="${u}">${u}</button>`).join('')}</div>
      ${field('roundIncrement', 'Round calculated weights to', L.fmtNum(st.roundIncrement), 'decimal', esc(st.unit))}
      <p class="muted small">Deload and warm-up weights are rounded to plates you can load. Changing units does not convert weights already entered.</p>
    </section>
    <section class="card">
      <h2>Deload week (week 4)</h2>
      ${field('d-weightPct', 'Reduce weight by', d.weightPct, 'numeric', '%')}
      ${field('d-setsPct', 'Reduce sets by', d.setsPct, 'numeric', '%')}
      ${field('d-repsPct', 'Reduce reps by', d.repsPct, 'numeric', '%')}
      ${field('d-durationPct', 'Reduce time by', d.durationPct, 'numeric', '%')}
      <p class="muted small">Any exercise can use its own deload numbers instead (Program → exercise).</p>
      <label class="field"><span>Weeks start on</span><select data-act="week-start">
        <option value="1" ${st.weekStartsOn === 1 ? 'selected' : ''}>Monday</option>
        <option value="0" ${st.weekStartsOn === 0 ? 'selected' : ''}>Sunday</option></select></label>
    </section>
    <section class="card">
      <h2>Default warm-up sets</h2>
      <p class="muted small">Percent of that day's working weight. Exercises can use their own scheme or turn warm-ups off.</p>
      ${schemeEditor(st.warmupScheme, 'defwu')}
      ${field('warmupRestSec', 'Rest after warm-up sets', st.warmupRestSec, 'numeric', 'sec')}
    </section>
    <section class="card">
      <h2>Workout</h2>
      <label class="switch-row"><span>Timer sounds<small>The silent switch can mute these</small></span><input type="checkbox" class="switch" data-act="sound" ${st.sound ? 'checked' : ''}></label>
      <button type="button" class="btn small" data-act="test-sound">Test sound</button>
      <label class="switch-row"><span>Keep screen on during workouts</span><input type="checkbox" class="switch" data-act="keep-awake" ${st.keepAwake ? 'checked' : ''}></label>
    </section>
    <section class="card">
      <h2>Metronome</h2>
      ${field('metroLeadIn', 'Delay before it starts', st.metroLeadIn, 'numeric', 'sec')}
      <p class="muted small">Time to put the phone down after tapping Start. Quiet ticks count down the delay.</p>
      ${field('metroBpm', 'Default beat speed', st.metroBpm, 'numeric', 'BPM')}
      <label class="switch-row"><span>Say rep numbers out loud<small>Tempo mode: speaks each completed rep</small></span><input type="checkbox" class="switch" data-act="metro-speak" ${st.metroSpeak ? 'checked' : ''}></label>
    </section>
    <section class="card">
      <h2>Appearance</h2>
      <div class="segmented">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" class="${st.theme === k ? 'on' : ''}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p class="muted small">Everything is stored only on this iPhone. Make a backup now and then (save it to Files or iCloud Drive) so you can restore it on a new phone.</p>
      <div class="stack">
        <button type="button" class="btn block" data-act="export-csv">Export history as CSV</button>
        <button type="button" class="btn block" data-act="export-backup">Back up everything</button>
        <label class="btn block">Restore from backup…<input type="file" accept=".json,application/json" data-act="restore" hidden></label>
        <button type="button" class="btn danger-ghost block" data-act="reset-program">Reset program to the starter template</button>
        <button type="button" class="btn danger-ghost block" data-act="erase">Erase all data</button>
      </div>
      <p class="muted small" id="storage-info"></p>
    </section>
    <p class="muted small center">LiftLog ${APP_VERSION} · works offline</p>`;
  storageInfo();
}

async function storageInfo() {
  const el = document.getElementById('storage-info');
  if (!el) return;
  try {
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = `${S.sessions.length} workouts saved.${persisted ? ' Storage is marked persistent.' : ''}`;
  } catch {}
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#141413' : '#f6f6f4');
}

// ---------- files ----------

async function shareFile(filename, mime, text) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const stamp = () => L.localDate(new Date().toISOString());

function exportCsv() {
  const csv = L.sessionsToCsv(S.sessions, unit());
  shareFile(`liftlog-history-${stamp()}.csv`, 'text/csv', csv);
}
function exportBackup() {
  shareFile(`liftlog-backup-${stamp()}.json`, 'application/json', JSON.stringify(L.makeBackup(S), null, 1));
}

async function restoreBackup(file) {
  try {
    const data = L.parseBackup(await file.text());
    if (!confirm(`Restore this backup? It has ${data.sessions.length} workouts and replaces everything currently in the app.`)) return;
    S = normalizeState({ ...data, active: null, ui: {} });
    await persistNow();
    applyTheme();
    toast('Backup restored');
    render();
  } catch (e) {
    alert(e.message || 'Could not restore that file.');
  }
}

// ============================================================
// EVENTS
// ============================================================

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function currentExercise() {
  const { parts } = parseRoute();
  const day = findDay(parts[2]);
  return { day, ex: day && day.exercises.find((e) => e.id === parts[4]) };
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const session = workoutSession();
  const row = btn.closest('.set-row');
  const ei = row ? Number(row.dataset.ei) : Number(btn.dataset.ei);
  const si = row ? Number(row.dataset.si) : null;
  const i = Number(btn.dataset.i);

  switch (act) {
    // today
    case 'pick-day': S.ui.pickDay = btn.dataset.id; render(); break;
    case 'start': startWorkout(); break;

    // workout
    case 'toggle-set': {
      const ex = session.exercises[ei];
      const set = ex.sets[si];
      set.done = !set.done;
      if (set.done && session === S.active) startRest(set.restSec);
      if (!set.done && session === S.active && S.active.rest) S.active.rest = null;
      sessionChanged();
      render();
      break;
    }
    case 'countdown': startCountdown(ei, si); break;
    case 'add-set': session.exercises[ei].sets.push(L.cloneSetForAdd(session.exercises[ei])); sessionChanged(); render(); break;
    case 'remove-set': session.exercises[ei].sets.pop(); sessionChanged(); render(); break;
    case 'add-exercise': addExerciseToSession(session); break;
    case 'finish': finishWorkout(); break;
    case 'discard':
      if (confirm('Discard this workout? Nothing from it will be saved.')) {
        S.active = null; closeMetro(); persistNow(); wakeLock.update(); hideOverlays(); render();
      }
      break;
    case 'save-edit': {
      stripUndone(editing);
      const idx = S.sessions.findIndex((x) => x.id === editing.id);
      if (idx >= 0) S.sessions[idx] = editing;
      const id = editing.id;
      editing = null;
      persistNow();
      toast('Changes saved');
      go(`#/history/${id}`);
      break;
    }

    // timers
    case 'rest-add': S.active.rest.endsAt += 30000; S.active.rest.total += 30; persist(); updateTimers(); break;
    case 'rest-sub': S.active.rest.endsAt -= 15000; persist(); updateTimers(); break;
    case 'rest-skip': S.active.rest = null; persist(); updateTimers(); break;
    case 'cd-pause': {
      const t = S.active.timer;
      const now = Date.now();
      if (t.lead) { t.lead = null; t.since = null; } else if (t.since) { t.acc = timerElapsed(t, now); t.since = null; } else { t.since = now; }
      persist(); updateTimers();
      break;
    }
    case 'cd-done': {
      const t = S.active.timer;
      // Done during the "get ready" lead-in means the planned time was done without the timer.
      completeCountdown(t.lead ? t.total : Math.round(timerElapsed(t) / 1000));
      break;
    }
    case 'cd-cancel': S.active.timer = null; persist(); updateTimers(); break;

    // metronome
    case 'metro-for': openMetro(ei); break;
    case 'metro-mode': if (!metro.isRunning()) { metroUI.mode = btn.dataset.m; renderMetro(); } break;
    case 'metro-bpm': if (!metro.isRunning()) { metroUI.bpm = Math.min(240, Math.max(20, metroUI.bpm + Number(btn.dataset.d))); renderMetro(); } break;
    case 'metro-start': startMetro(); break;
    case 'metro-stop': stopMetro(); break;
    case 'metro-hide': document.getElementById('metro').hidden = true; updateMetro(); break;
    case 'metro-open': document.getElementById('metro').hidden = false; renderMetro(); break;

    // program
    case 'day-up': moveItem(S.program.days, i, -1); persist(); render(); break;
    case 'day-down': moveItem(S.program.days, i, 1); persist(); render(); break;
    case 'add-day': {
      const name = (prompt('Name for the new workout day (e.g. Upper, Arms)') || '').trim();
      if (!name) break;
      const day = { id: L.uid(), name, exercises: [] };
      S.program.days.push(day);
      persist();
      go(`#/program/day/${day.id}`);
      break;
    }
    case 'ex-up': case 'ex-down': {
      const day = findDay(parseRoute().parts[2]);
      moveItem(day.exercises, i, act === 'ex-up' ? -1 : 1);
      persist(); render();
      break;
    }
    case 'add-ex': {
      const day = findDay(parseRoute().parts[2]);
      const name = (prompt('Exercise name') || '').trim();
      if (!name) break;
      const ex = {
        id: L.uid(), name, trackWeight: true, trackReps: true, trackTime: false, sets: 3, reps: 8, weight: 0,
        duration: 0, restSec: 90, warmup: { mode: 'default', scheme: [] }, deloadOverride: null,
      };
      day.exercises.push(ex);
      persist();
      go(`#/program/day/${day.id}/ex/${ex.id}`);
      break;
    }
    case 'delete-day': {
      const day = findDay(parseRoute().parts[2]);
      if (!confirm(`Delete “${day.name}” and its exercises? Your logged history is kept.`)) break;
      S.program.days = S.program.days.filter((d) => d !== day);
      persist(); go('#/program');
      break;
    }
    case 'rest-preset': { const { ex } = currentExercise(); ex.restSec = Number(btn.dataset.s); persist(); render(); break; }
    case 'warm-mode': {
      const { ex } = currentExercise();
      const m = btn.dataset.m;
      ex.warmup = ex.warmup || { mode: 'default', scheme: [] };
      if (m === 'custom' && !(ex.warmup.scheme || []).length) ex.warmup.scheme = clone(S.settings.warmupScheme);
      ex.warmup.mode = m;
      persist(); render();
      break;
    }
    case 'exwu-add': { const { ex } = currentExercise(); ex.warmup.scheme.push({ pct: 50, reps: 5 }); persist(); render(); break; }
    case 'exwu-del': { const { ex } = currentExercise(); ex.warmup.scheme.splice(i, 1); persist(); render(); break; }
    case 'deload-mode': {
      const { ex } = currentExercise();
      ex.deloadOverride = btn.dataset.m === 'custom' ? clone(S.settings.deload) : null;
      persist(); render();
      break;
    }
    case 'delete-ex': {
      const { day, ex } = currentExercise();
      if (!confirm(`Delete ${ex.name} from ${day.name}? Your logged history is kept.`)) break;
      day.exercises = day.exercises.filter((x) => x !== ex);
      persist(); go(`#/program/day/${day.id}`);
      break;
    }

    // history
    case 'export-csv': exportCsv(); break;
    case 'export-backup': exportBackup(); break;
    case 'delete-session':
      if (confirm('Delete this workout from your history? This cannot be undone.')) {
        S.sessions = S.sessions.filter((x) => x.id !== btn.dataset.id);
        persist(); go('#/history');
      }
      break;

    // settings
    case 'unit': {
      const u = btn.dataset.u;
      if (u === S.settings.unit) break;
      const wasDefault = S.settings.roundIncrement === (S.settings.unit === 'lb' ? 5 : 2.5);
      S.settings.unit = u;
      if (wasDefault) S.settings.roundIncrement = u === 'lb' ? 5 : 2.5;
      persist(); render();
      break;
    }
    case 'defwu-add': S.settings.warmupScheme.push({ pct: 50, reps: 5 }); persist(); render(); break;
    case 'defwu-del': S.settings.warmupScheme.splice(i, 1); persist(); render(); break;
    case 'test-sound': audio.restOver(true); break;
    case 'theme': S.settings.theme = btn.dataset.t; applyTheme(); persist(); render(); break;
    case 'reset-program':
      if (confirm('Replace your program with the starter Push/Pull/Legs template? History is kept.')) {
        S.program = defaultProgram(); persist(); toast('Program reset');
      }
      break;
    case 'erase':
      if (confirm('Erase ALL data — program, history and settings?') && confirm('Are you sure? Make a backup first if you might want it.')) {
        indexedDB.deleteDatabase('liftlog');
        try { localStorage.clear(); } catch {}
        location.reload();
      }
      break;
    default: break;
  }
});

// Toggles, selects and file inputs.
document.addEventListener('change', (e) => {
  const el = e.target;
  const act = el.dataset.act;
  if (!act) return;
  switch (act) {
    case 'toggle-deload': S.ui.deloadChoice = el.checked; render(); break;
    case 'set-week':
      S.settings.cycleStart = L.cycleStartForWeek(Number(el.value), new Date(), S.settings.weekStartsOn).toISOString();
      persist(); render();
      break;
    case 'week-start': {
      const week = currentWeek();
      S.settings.weekStartsOn = Number(el.value);
      S.settings.cycleStart = L.cycleStartForWeek(week, new Date(), S.settings.weekStartsOn).toISOString();
      persist(); render();
      break;
    }
    case 'track': {
      const { ex } = currentExercise();
      ex[el.dataset.k] = el.checked;
      if (!ex.trackWeight && !ex.trackReps && !ex.trackTime) {
        ex[el.dataset.k] = true;
        toast('Record at least one of weight, reps or time');
      }
      persist(); render();
      break;
    }
    case 'prog-ex': S.ui.progEx = el.value; render(); break;
    case 'prog-metric': S.ui.progMetric = el.value; render(); break;
    case 'prog-deload': S.ui.progHideDeload = !el.checked; render(); break;
    case 'sound': S.settings.sound = el.checked; persist(); break;
    case 'keep-awake': S.settings.keepAwake = el.checked; persist(); wakeLock.update(); break;
    case 'metro-speak': S.settings.metroSpeak = el.checked; persist(); break;
    case 'metro-stopafter': metroUI.stopAfter = el.checked; break;
    case 'restore': if (el.files[0]) restoreBackup(el.files[0]); el.value = ''; break;
    default: break;
  }
});

// Typing: update the model in place without re-rendering (keeps the keyboard open).
document.addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (!f && !el.dataset.metro) return;
  const v = el.value;
  const i = Number(el.dataset.i);
  const tab = parseRoute().tab;

  if (el.dataset.metro) {
    if (el.dataset.metro === 'tempo') {
      metroUI.tempo = v;
      const help = document.getElementById('metro-tempo-help');
      if (help) help.textContent = tempoHelp(v);
      const startBtn = document.querySelector('[data-act="metro-start"]');
      if (startBtn) startBtn.disabled = !L.parseTempo(v);
    } else if (el.dataset.metro === 'bpm') {
      const n = num(v);
      if (n) metroUI.bpm = Math.round(L.clampNum(n, 20, 240));
    }
    return;
  }

  if (tab === 'today' || (tab === 'history' && editing)) {
    const session = workoutSession();
    if (!session) return;
    const row = el.closest('.set-row');
    if (row) {
      const set = session.exercises[Number(row.dataset.ei)].sets[Number(row.dataset.si)];
      const n = num(v);
      set[f] = n == null ? null : f === 'weight' ? n : Math.round(n);
    } else if (f === 'ex-notes') session.exercises[Number(el.dataset.ei)].notes = v;
    else if (f === 'session-notes') session.notes = v;
    sessionChanged();
    return;
  }

  if (tab === 'program') {
    const { parts } = parseRoute();
    if (f === 'day-name') { findDay(parts[2]).name = v.trim() || 'Workout'; persist(); return; }
    const { ex } = currentExercise();
    if (!ex) return;
    const n = num(v);
    if (f === 'ex-name') ex.name = v.trim() || 'Exercise';
    else if (f === 'tempo') {
      const tp = L.parseTempo(v);
      ex.tempo = tp ? tp.text : v.trim() ? ex.tempo : '';
      const help = document.getElementById('tempo-help');
      if (help) help.textContent = tempoHelp(v);
    }
    else if (f === 'sets') ex.sets = Math.max(1, Math.round(n || 1));
    else if (['reps', 'duration', 'restSec'].includes(f)) ex[f] = Math.max(0, Math.round(n || 0));
    else if (f === 'weight') ex.weight = Math.max(0, n || 0);
    else if (f.startsWith('dl-')) ex.deloadOverride[f.slice(3)] = L.clampNum(n, 0, 100);
    else if (f === 'exwu-pct') ex.warmup.scheme[i].pct = L.clampNum(n, 0, 100);
    else if (f === 'exwu-reps') ex.warmup.scheme[i].reps = Math.round(L.clampNum(n, 0, 999));
    persist();
    const prev = document.getElementById('ex-preview');
    if (prev) prev.innerHTML = exPreview(ex);
    return;
  }

  if (tab === 'settings') {
    const st = S.settings;
    const n = num(v);
    if (f === 'roundIncrement') st.roundIncrement = L.clampNum(n, 0, 1000);
    else if (f.startsWith('d-')) st.deload[f.slice(2)] = L.clampNum(n, 0, 100);
    else if (f === 'defwu-pct') st.warmupScheme[i].pct = L.clampNum(n, 0, 100);
    else if (f === 'defwu-reps') st.warmupScheme[i].reps = Math.round(L.clampNum(n, 0, 999));
    else if (f === 'warmupRestSec') st.warmupRestSec = Math.round(L.clampNum(n, 0, 3600));
    else if (f === 'metroLeadIn') st.metroLeadIn = Math.round(L.clampNum(n, 0, 60));
    else if (f === 'metroBpm') st.metroBpm = Math.round(L.clampNum(n || 60, 20, 240));
    persist();
  }
});

// Select all text when tapping into a number box, so typing replaces it.
document.addEventListener('focusin', (e) => {
  if (e.target.matches && e.target.matches('input.num')) setTimeout(() => e.target.select(), 0);
});

window.addEventListener('hashchange', () => {
  if (!location.hash.includes('/edit')) editing = null;
  render();
});

document.addEventListener('visibilitychange', () => {
  if (!S) return;
  if (document.visibilityState === 'hidden' && metro.isRunning()) {
    stopMetro('Stopped because the app left the screen');
  }
  if (document.visibilityState === 'hidden') persistNow();
  else updateTimers();
  wakeLock.update();
});
window.addEventListener('pagehide', () => persistNow());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (parseRoute().tab === 'progress' && Math.abs(window.innerWidth - lastWidth) > 40) { lastWidth = window.innerWidth; render(); }
});

// ---------- service worker (offline + updates) ----------

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('An app update is ready', { label: 'Reload', run: () => { persistNow().then(() => location.reload()); } });
        }
      });
    });
  }).catch((e) => console.warn('SW registration failed', e));
}

// ---------- boot ----------

async function boot() {
  S = await loadState();
  applyTheme();
  document.getElementById('tabs').innerHTML = [['today', 'Today'], ['program', 'Program'], ['history', 'History'], ['progress', 'Progress'], ['settings', 'Settings']]
    .map(([k, l]) => `<a href="#/${k}" data-tab="${k}">${icon(k)}<span>${l}</span></a>`).join('');
  render();
  setInterval(updateTimers, 250);
  setInterval(updateMetro, 100);
  audio.installUnlock();
  wakeLock.update();
  registerSW();
  requestPersistence();
}

boot();
