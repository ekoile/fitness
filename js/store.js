// Persistence: the whole app state lives in one IndexedDB record on the phone.
import { uid, cycleStartForWeek } from './logic.js';

const DB_NAME = 'liftlog';
const STORE = 'kv';
const KEY = 'state';

export function defaultSettings() {
  return {
    unit: 'lb',
    roundIncrement: 5,
    theme: 'auto', // auto | light | dark
    weekStartsOn: 1, // Monday
    cycleStart: cycleStartForWeek(1, new Date(), 1).toISOString(),
    deload: { weightPct: 10, repsPct: 0, setsPct: 50, durationPct: 0 },
    warmupScheme: [
      { pct: 40, reps: 5 },
      { pct: 60, reps: 3 },
      { pct: 80, reps: 1 },
    ],
    warmupRestSec: 60,
    sound: true,
    keepAwake: true,
  };
}

function ex(name, o) {
  return {
    id: uid(),
    name,
    trackWeight: true,
    trackReps: true,
    trackTime: false,
    sets: 3,
    reps: 8,
    weight: 0,
    duration: 0,
    restSec: 90,
    warmup: { mode: 'default', scheme: [] },
    deloadOverride: null,
    ...o,
  };
}

// A starter Push / Pull / Legs program. Everything is editable in the app.
export function defaultProgram() {
  return {
    days: [
      {
        id: uid(), name: 'Push', exercises: [
          ex('Bench Press', { sets: 4, reps: 6, weight: 155, restSec: 180 }),
          ex('Overhead Press', { sets: 3, reps: 8, weight: 85, restSec: 120 }),
          ex('Incline Dumbbell Press', { sets: 3, reps: 10, weight: 45, warmup: { mode: 'off', scheme: [] } }),
          ex('Triceps Pushdown', { sets: 3, reps: 12, weight: 50, restSec: 60, warmup: { mode: 'off', scheme: [] } }),
        ],
      },
      {
        id: uid(), name: 'Pull', exercises: [
          ex('Barbell Row', { sets: 4, reps: 8, weight: 135, restSec: 120 }),
          ex('Pull-up', { trackWeight: false, sets: 3, reps: 8, restSec: 120, warmup: { mode: 'off', scheme: [] } }),
          ex('Face Pull', { sets: 3, reps: 15, weight: 30, restSec: 60, warmup: { mode: 'off', scheme: [] } }),
          ex('Biceps Curl', { sets: 3, reps: 12, weight: 25, restSec: 60, warmup: { mode: 'off', scheme: [] } }),
        ],
      },
      {
        id: uid(), name: 'Legs', exercises: [
          ex('Back Squat', { sets: 4, reps: 5, weight: 185, restSec: 180, warmup: { mode: 'custom', scheme: [
            { pct: 40, reps: 5 }, { pct: 60, reps: 3 }, { pct: 75, reps: 2 }, { pct: 90, reps: 1 },
          ] } }),
          ex('Romanian Deadlift', { sets: 3, reps: 8, weight: 135, restSec: 120 }),
          ex('Farmer Carry', { trackReps: false, trackTime: true, sets: 3, weight: 50, duration: 40, restSec: 90, warmup: { mode: 'off', scheme: [] } }),
          ex('Plank', { trackWeight: false, trackReps: false, trackTime: true, sets: 3, duration: 60, restSec: 60, warmup: { mode: 'off', scheme: [] } }),
        ],
      },
    ],
  };
}

export function defaultState() {
  return { settings: defaultSettings(), program: defaultProgram(), sessions: [], active: null, ui: {} };
}

// Fill in anything missing (older saves, restored backups).
export function normalizeState(s) {
  const d = defaultSettings();
  const settings = { ...d, ...(s.settings || {}) };
  settings.deload = { ...d.deload, ...(settings.deload || {}) };
  if (!Array.isArray(settings.warmupScheme)) settings.warmupScheme = d.warmupScheme;
  const program = s.program && Array.isArray(s.program.days) ? s.program : defaultProgram();
  for (const day of program.days) {
    day.id ||= uid();
    day.exercises = (day.exercises || []).map((e) => ex(e.name || 'Exercise', e));
  }
  return {
    settings,
    program,
    sessions: Array.isArray(s.sessions) ? s.sessions : [],
    active: s.active || null,
    ui: s.ui || {},
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise;
function db() {
  dbPromise ||= openDb();
  return dbPromise;
}

export async function loadState() {
  try {
    const d = await db();
    const value = await new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return value ? normalizeState(value) : defaultState();
  } catch (e) {
    console.error('load failed', e);
    // Fall back to localStorage copy if IndexedDB is unavailable.
    try {
      const raw = localStorage.getItem('liftlog-state');
      if (raw) return normalizeState(JSON.parse(raw));
    } catch {}
    return defaultState();
  }
}

export async function saveState(state) {
  const plain = JSON.parse(JSON.stringify(state));
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(plain, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('IndexedDB save failed, using localStorage', e);
    try { localStorage.setItem('liftlog-state', JSON.stringify(plain)); } catch {}
  }
}

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
