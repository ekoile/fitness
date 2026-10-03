// Pure functions: no DOM, no storage. Everything here is unit-tested in tests/.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CYCLE_WEEKS = 4; // week 4 is the deload week

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function clampNum(v, min = 0, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Round a weight to the nearest loadable increment (e.g. 5 lb, 2.5 kg).
export function roundTo(value, increment) {
  if (!increment || increment <= 0) return Math.round(value * 100) / 100;
  const r = Math.round(value / increment) * increment;
  return Math.round(r * 100) / 100; // trim float noise like 132.50000001
}

// ---------- Weeks & the 4-week cycle ----------

// Local-midnight timestamp for a date.
export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Start of the week containing `d`. weekStartsOn: 0 = Sunday, 1 = Monday.
export function startOfWeek(d, weekStartsOn = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

// Whole calendar days between two dates (DST-safe because we round).
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

// Which week of the cycle (1..4) `date` falls in, given the cycle's start.
// Automatically wraps: after week 4 comes week 1 again.
export function cycleWeek(cycleStart, date, weekStartsOn = 1) {
  const start = startOfWeek(cycleStart, weekStartsOn);
  const cur = startOfWeek(date, weekStartsOn);
  const weeks = Math.floor(daysBetween(start, cur) / 7);
  return (((weeks % CYCLE_WEEKS) + CYCLE_WEEKS) % CYCLE_WEEKS) + 1;
}

// Cycle start date that makes `date` fall in `week` (1..4).
export function cycleStartForWeek(week, date, weekStartsOn = 1) {
  const x = startOfWeek(date, weekStartsOn);
  x.setDate(x.getDate() - (week - 1) * 7);
  return x;
}

export function isDeloadWeek(week) {
  return week === CYCLE_WEEKS;
}

// ---------- Deload ----------

// Percent reductions, e.g. { weightPct: 10, repsPct: 0, setsPct: 50, durationPct: 0 }.
export function effectiveDeload(settings, exercise) {
  return exercise && exercise.deloadOverride ? exercise.deloadOverride : settings.deload;
}

function reduce(v, pct) {
  return v * (1 - clampNum(pct, 0, 100) / 100);
}

// The working-set targets for an exercise, with deload applied when needed.
export function plannedTargets(exercise, settings, deload) {
  const base = {
    sets: clampNum(exercise.sets, 1, 99),
    reps: clampNum(exercise.reps, 0, 999),
    weight: clampNum(exercise.weight, 0, 99999),
    duration: clampNum(exercise.duration, 0, 86400),
  };
  if (!deload) return base;
  const d = effectiveDeload(settings, exercise);
  return {
    sets: Math.max(1, Math.round(reduce(base.sets, d.setsPct))),
    reps: base.reps > 0 ? Math.max(1, Math.round(reduce(base.reps, d.repsPct))) : 0,
    weight: roundTo(reduce(base.weight, d.weightPct), settings.roundIncrement),
    duration: base.duration > 0 ? Math.max(5, Math.round(reduce(base.duration, d.durationPct) / 5) * 5) : 0,
  };
}

// ---------- Warm-ups ----------

export function warmupScheme(exercise, settings) {
  const w = exercise.warmup || { mode: 'default' };
  if (w.mode === 'off') return [];
  if (w.mode === 'custom') return w.scheme || [];
  return settings.warmupScheme || [];
}

// Warm-up sets as a ratio of the working weight. Only for weighted exercises.
export function warmupSets(exercise, settings, workingWeight) {
  if (!exercise.trackWeight || !(workingWeight > 0)) return [];
  return warmupScheme(exercise, settings)
    .filter((s) => s.pct > 0)
    .map((s) => ({
      pct: s.pct,
      weight: roundTo((workingWeight * s.pct) / 100, settings.roundIncrement),
      reps: clampNum(s.reps, 0, 999),
    }));
}

// ---------- Building a session ----------

function newSet(type, planned, ex, restSec, pct) {
  return {
    id: uid(),
    type, // 'warmup' | 'working'
    pct: pct || null,
    planned: { ...planned },
    weight: ex.trackWeight ? planned.weight : null,
    reps: ex.trackReps ? planned.reps : null,
    duration: ex.trackTime ? planned.duration : null,
    restSec,
    done: false,
  };
}

export function buildSessionExercise(ex, settings, deload) {
  const t = plannedTargets(ex, settings, deload);
  const sets = [];
  const warmRest = clampNum(settings.warmupRestSec, 0, 3600);
  for (const w of warmupSets(ex, settings, t.weight)) {
    sets.push(newSet('warmup', { weight: w.weight, reps: w.reps, duration: 0 }, ex, warmRest, w.pct));
  }
  for (let i = 0; i < t.sets; i++) {
    sets.push(newSet('working', { weight: t.weight, reps: t.reps, duration: t.duration }, ex, ex.restSec));
  }
  return {
    id: uid(),
    exerciseId: ex.id,
    name: ex.name,
    trackWeight: !!ex.trackWeight,
    trackReps: !!ex.trackReps,
    trackTime: !!ex.trackTime,
    restSec: ex.restSec,
    notes: '',
    sets,
  };
}

export function buildSession(day, settings, { week, deload, now = new Date() }) {
  return {
    id: uid(),
    dayId: day.id,
    dayName: day.name,
    week,
    deload: !!deload,
    startedAt: now.toISOString(),
    finishedAt: null,
    notes: '',
    exercises: day.exercises.map((ex) => buildSessionExercise(ex, settings, deload)),
  };
}

// Extra set copied from the last set of the same type (used by "+ Add set").
export function cloneSetForAdd(sessionExercise) {
  const working = sessionExercise.sets.filter((s) => s.type === 'working');
  const src = working[working.length - 1] || sessionExercise.sets[sessionExercise.sets.length - 1];
  const base = src
    ? { ...src, id: uid(), done: false, type: 'working', pct: null }
    : {
        id: uid(), type: 'working', pct: null,
        planned: { weight: 0, reps: 0, duration: 0 },
        weight: sessionExercise.trackWeight ? 0 : null,
        reps: sessionExercise.trackReps ? 0 : null,
        duration: sessionExercise.trackTime ? 0 : null,
        restSec: sessionExercise.restSec, done: false,
      };
  return base;
}

// ---------- Rotation ----------

// The day after the most recently trained day, in program order.
export function nextDayId(days, sessions) {
  if (!days.length) return null;
  const last = [...sessions]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .find((s) => days.some((d) => d.id === s.dayId));
  if (!last) return days[0].id;
  const i = days.findIndex((d) => d.id === last.dayId);
  return days[(i + 1) % days.length].id;
}

// ---------- History lookups ----------

export const normName = (n) => String(n || '').trim().toLowerCase();

// Most recent completed session exercise with the same name (excluding a session id).
export function lastPerformance(sessions, name, excludeSessionId) {
  const key = normName(name);
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const s of sorted) {
    if (s.id === excludeSessionId) continue;
    const ex = s.exercises.find((e) => normName(e.name) === key && e.sets.some((x) => x.done));
    if (ex) return { session: s, exercise: ex };
  }
  return null;
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Accepts "90", "1:30", "01:30". Returns seconds or null.
export function parseDuration(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

// Compact "3×8 @ 185" style description of the done working sets.
export function summarizeSets(ex, unit) {
  const done = ex.sets.filter((s) => s.done && s.type === 'working');
  if (!done.length) return '';
  return done
    .map((s) => {
      const parts = [];
      if (ex.trackWeight && s.weight != null) parts.push(`${fmtNum(s.weight)}${unit ? ' ' + unit : ''}`);
      if (ex.trackReps && s.reps != null) parts.push(`×${s.reps}`);
      if (ex.trackTime && s.duration != null) parts.push(formatDuration(s.duration));
      return parts.join(' ');
    })
    .join(', ');
}

export function fmtNum(n) {
  if (n == null || n === '') return '';
  const x = Math.round(Number(n) * 100) / 100;
  return String(x);
}

// ---------- Progress metrics (for charts) ----------

export const METRICS = {
  topWeight: { label: 'Top working weight', needs: ['trackWeight'] },
  e1rm: { label: 'Estimated 1-rep max', needs: ['trackWeight', 'trackReps'] },
  volume: { label: 'Volume (weight × reps)', needs: ['trackWeight', 'trackReps'] },
  maxReps: { label: 'Best set (reps)', needs: ['trackReps'] },
  totalReps: { label: 'Total reps', needs: ['trackReps'] },
  maxDuration: { label: 'Longest set (time)', needs: ['trackTime'] },
  totalDuration: { label: 'Total time', needs: ['trackTime'] },
};

export function metricValue(ex, metric) {
  const sets = ex.sets.filter((s) => s.done && s.type === 'working');
  if (!sets.length) return null;
  const w = (s) => Number(s.weight) || 0;
  const r = (s) => Number(s.reps) || 0;
  const d = (s) => Number(s.duration) || 0;
  switch (metric) {
    case 'topWeight': return Math.max(...sets.map(w));
    case 'e1rm': return Math.round(Math.max(...sets.map((s) => (r(s) > 0 ? w(s) * (1 + r(s) / 30) : 0))) * 10) / 10;
    case 'volume': return sets.reduce((a, s) => a + w(s) * r(s), 0);
    case 'maxReps': return Math.max(...sets.map(r));
    case 'totalReps': return sets.reduce((a, s) => a + r(s), 0);
    case 'maxDuration': return Math.max(...sets.map(d));
    case 'totalDuration': return sets.reduce((a, s) => a + d(s), 0);
    default: return null;
  }
}

export function progressSeries(sessions, name, metric) {
  const key = normName(name);
  return [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((s) => {
      const ex = s.exercises.find((e) => normName(e.name) === key);
      if (!ex) return [];
      const v = metricValue(ex, metric);
      return v == null ? [] : [{ date: s.startedAt, value: v, deload: s.deload, sessionId: s.id }];
    });
}

// ---------- CSV ----------

export const CSV_HEADERS = [
  'Date', 'Start Time', 'Program Week', 'Deload', 'Workout Day', 'Exercise', 'Set #', 'Set Type',
  'Weight', 'Unit', 'Reps', 'Duration (sec)', 'Planned Weight', 'Planned Reps', 'Planned Duration (sec)',
  'Rest (sec)', 'Exercise Notes', 'Session Notes',
];

export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // Stop spreadsheet apps from treating user text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function pad2(n) { return String(n).padStart(2, '0'); }
export function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function localTime(iso) {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// One row per completed set, oldest session first.
export function sessionsToCsv(sessions, unit) {
  const rows = [CSV_HEADERS];
  const sorted = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const s of sorted) {
    for (const ex of s.exercises) {
      let warm = 0;
      let work = 0;
      for (const set of ex.sets) {
        if (!set.done) continue;
        const isWarm = set.type === 'warmup';
        const n = isWarm ? ++warm : ++work;
        rows.push([
          localDate(s.startedAt), localTime(s.startedAt), s.week, s.deload ? 'Yes' : 'No', s.dayName,
          ex.name, isWarm ? `W${n}` : n, isWarm ? 'Warm-up' : 'Working',
          ex.trackWeight ? set.weight : '', ex.trackWeight ? unit : '',
          ex.trackReps ? set.reps : '', ex.trackTime ? set.duration : '',
          ex.trackWeight ? set.planned?.weight : '', ex.trackReps ? set.planned?.reps : '',
          ex.trackTime ? set.planned?.duration : '',
          set.restSec, ex.notes, s.notes,
        ]);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- Backup ----------

export const BACKUP_FORMAT = 'liftlog-backup';

export function makeBackup(state) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    program: state.program,
    sessions: state.sessions,
  };
}

// Throws a readable error if the file is not a backup this app made.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new Error('That file is not a LiftLog backup.');
  if (!data.program || !Array.isArray(data.program.days) || !Array.isArray(data.sessions)) {
    throw new Error('The backup is missing its program or history.');
  }
  return { settings: data.settings, program: data.program, sessions: data.sessions };
}
