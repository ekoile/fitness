import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const settings = {
  unit: 'lb',
  roundIncrement: 5,
  deload: { weightPct: 10, repsPct: 0, setsPct: 50, durationPct: 0 },
  warmupScheme: [{ pct: 40, reps: 5 }, { pct: 60, reps: 3 }, { pct: 80, reps: 1 }],
  warmupRestSec: 60,
};
const bench = {
  id: 'b', name: 'Bench Press', trackWeight: true, trackReps: true, trackTime: false,
  sets: 4, reps: 6, weight: 155, duration: 0, restSec: 180, warmup: { mode: 'default' }, deloadOverride: null,
};

test('roundTo rounds to loadable increments', () => {
  assert.equal(L.roundTo(139.5, 5), 140);
  assert.equal(L.roundTo(61.4, 2.5), 62.5);
  assert.equal(L.roundTo(61.2, 2.5), 60);
  assert.equal(L.roundTo(61.234, 0), 61.23);
});

test('cycle week wraps 1→4→1 and week 4 is deload', () => {
  const start = new Date(2026, 8, 7); // Monday Sep 7 2026
  const at = (days) => L.cycleWeek(start, new Date(2026, 8, 7 + days), 1);
  assert.equal(at(0), 1);
  assert.equal(at(6), 1);
  assert.equal(at(7), 2);
  assert.equal(at(21), 4);
  assert.equal(at(27), 4);
  assert.equal(at(28), 1); // restarts automatically
  assert.equal(at(-1), 4); // before the start date
  assert.ok(L.isDeloadWeek(4));
  assert.ok(!L.isDeloadWeek(3));
});

test('cycleStartForWeek puts today in the chosen week', () => {
  const today = new Date(2026, 9, 3);
  for (const w of [1, 2, 3, 4]) {
    assert.equal(L.cycleWeek(L.cycleStartForWeek(w, today, 1), today, 1), w);
    assert.equal(L.cycleWeek(L.cycleStartForWeek(w, today, 0), today, 0), w);
  }
});

test('deload reduces by percentages; normal weeks unchanged', () => {
  assert.deepEqual(L.plannedTargets(bench, settings, false), { sets: 4, reps: 6, weight: 155, duration: 0 });
  assert.deepEqual(L.plannedTargets(bench, settings, true), { sets: 2, reps: 6, weight: 140, duration: 0 });
});

test('per-exercise deload override wins', () => {
  const ex = { ...bench, deloadOverride: { weightPct: 40, repsPct: 50, setsPct: 0, durationPct: 0 } };
  assert.deepEqual(L.plannedTargets(ex, settings, true), { sets: 4, reps: 3, weight: 95, duration: 0 });
});

test('deload never drops below one set / one rep', () => {
  const ex = { ...bench, sets: 1, reps: 1, deloadOverride: { weightPct: 0, repsPct: 90, setsPct: 90, durationPct: 0 } };
  const t = L.plannedTargets(ex, settings, true);
  assert.equal(t.sets, 1);
  assert.equal(t.reps, 1);
});

test('timed exercises deload duration rounded to 5s', () => {
  const plank = { ...bench, trackWeight: false, trackReps: false, trackTime: true, weight: 0, reps: 0, duration: 60, deloadOverride: { weightPct: 0, repsPct: 0, setsPct: 0, durationPct: 33 } };
  assert.equal(L.plannedTargets(plank, settings, true).duration, 40);
});

test('warm-ups follow default, custom and off schemes', () => {
  assert.deepEqual(L.warmupSets(bench, settings, 155).map((w) => [w.weight, w.reps]), [[60, 5], [95, 3], [125, 1]]);
  const custom = { ...bench, warmup: { mode: 'custom', scheme: [{ pct: 50, reps: 8 }] } };
  assert.deepEqual(L.warmupSets(custom, settings, 200).map((w) => w.weight), [100]);
  assert.deepEqual(L.warmupSets({ ...bench, warmup: { mode: 'off' } }, settings, 155), []);
  assert.deepEqual(L.warmupSets({ ...bench, trackWeight: false }, settings, 155), []);
});

test('session build: warm-ups use the deloaded working weight', () => {
  const day = { id: 'd', name: 'Push', exercises: [bench] };
  const s = L.buildSession(day, settings, { week: 4, deload: true });
  const sets = s.exercises[0].sets;
  assert.equal(sets.filter((x) => x.type === 'warmup').length, 3);
  assert.equal(sets.filter((x) => x.type === 'working').length, 2);
  assert.equal(sets[3].weight, 140);
  assert.equal(sets[2].weight, 110); // 80% of 140 = 112 → 110
  assert.equal(sets[0].restSec, 60);
  assert.equal(sets[3].restSec, 180);
});

test('weight + time exercise records both', () => {
  const carry = { ...bench, name: 'Farmer Carry', trackReps: false, trackTime: true, duration: 40, warmup: { mode: 'off' } };
  const ex = L.buildSessionExercise(carry, settings, false);
  assert.equal(ex.sets[0].weight, 155);
  assert.equal(ex.sets[0].duration, 40);
  assert.equal(ex.sets[0].reps, null);
});

test('rotation picks the next day after the last session', () => {
  const days = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(L.nextDayId(days, []), 'a');
  const sessions = [
    { dayId: 'a', startedAt: '2026-10-01T10:00:00Z' },
    { dayId: 'c', startedAt: '2026-10-02T10:00:00Z' },
  ];
  assert.equal(L.nextDayId(days, sessions), 'a');
  assert.equal(L.nextDayId(days, sessions.slice(0, 1)), 'b');
});

test('lastPerformance finds the most recent matching exercise', () => {
  const mk = (id, at, w) => ({ id, startedAt: at, exercises: [{ name: 'bench press', sets: [{ done: true, type: 'working', weight: w, reps: 5 }] }] });
  const sessions = [mk('1', '2026-09-01T10:00:00Z', 100), mk('2', '2026-09-05T10:00:00Z', 110)];
  assert.equal(L.lastPerformance(sessions, 'Bench Press').session.id, '2');
  assert.equal(L.lastPerformance(sessions, 'Bench Press', '2').session.id, '1');
});

test('duration parse/format', () => {
  assert.equal(L.formatDuration(90), '1:30');
  assert.equal(L.parseDuration('1:30'), 90);
  assert.equal(L.parseDuration('45'), 45);
  assert.equal(L.parseDuration(''), null);
});

test('CSV: one row per done set, escaped, warm-ups labelled', () => {
  const s = {
    id: 's', startedAt: new Date(2026, 9, 3, 7, 5).toISOString(), week: 4, deload: true, dayName: 'Push',
    notes: 'Felt "great", slept 8h',
    exercises: [{
      name: 'Bench Press', trackWeight: true, trackReps: true, trackTime: false, notes: '=bad formula\nline 2',
      sets: [
        { type: 'warmup', done: true, weight: 60, reps: 5, duration: null, restSec: 60, planned: { weight: 60, reps: 5 } },
        { type: 'working', done: true, weight: 140, reps: 6, duration: null, restSec: 180, planned: { weight: 140, reps: 6 } },
        { type: 'working', done: false, weight: 140, reps: 6, duration: null, restSec: 180, planned: { weight: 140, reps: 6 } },
      ],
    }],
  };
  const csv = L.sessionsToCsv([s], 'lb');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], L.CSV_HEADERS.join(','));
  assert.equal(csv.match(/2026-10-03,07:05/g).length, 2);
  assert.ok(lines[1].startsWith('2026-10-03,07:05,4,Yes,Push,Bench Press,W1,Warm-up,60,lb,5,,60,5,,60,'));
  assert.ok(csv.includes('"\'=bad formula\nline 2"'));
  assert.ok(csv.includes('"Felt ""great"", slept 8h"'));
});

test('backup round trip and validation', () => {
  const state = { settings, program: { days: [] }, sessions: [{ id: 'x' }] };
  const back = L.parseBackup(JSON.stringify(L.makeBackup(state)));
  assert.equal(back.sessions.length, 1);
  assert.throws(() => L.parseBackup('{"hello":1}'), /not a LiftLog backup/);
  assert.throws(() => L.parseBackup('nope'), /not valid JSON/);
});

test('progress metrics use working sets only', () => {
  const ex = { sets: [
    { type: 'warmup', done: true, weight: 300, reps: 1 },
    { type: 'working', done: true, weight: 100, reps: 10 },
    { type: 'working', done: true, weight: 110, reps: 5 },
  ] };
  assert.equal(L.metricValue(ex, 'topWeight'), 110);
  assert.equal(L.metricValue(ex, 'volume'), 1550);
  assert.equal(L.metricValue(ex, 'e1rm'), 133.3);
  assert.equal(L.metricValue(ex, 'totalReps'), 15);
});
