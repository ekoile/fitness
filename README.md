# LiftLog: workout planner and exercise logger

An iPhone app you install from Safari to your Home Screen. It works fully offline, needs no account, and keeps all data on your phone.

## Features

- **Rotating program:** workout days with names you choose (Push / Pull / Legs, …) rotate in order. The app suggests the next day, and you can pick another.
- **4-week cycle with automatic deload:** weeks 1–3 use your normal numbers. Week 4 reduces weight, sets, reps and time by percentages you set. After week 4 the cycle goes back to week 1 on its own. Any exercise can have its own deload percentages, and you can switch deload on or off for a single session.
- **Logging:** each set records weight, reps and/or time. An exercise can track weight and time together, e.g. a farmer carry. Sets start filled in with the planned numbers, so you only change what was different.
- **Last time:** each exercise shows what you did last time and the note you left.
- **Notes:** one per exercise, plus one for the whole session.
- **Rest timer:** starts on its own when you tick off a set. Each exercise has its own rest time, and there are −15s / +30s / Skip buttons.
- **Countdown timer** for timed sets, with a 3-second "get ready", beeps, and pause/done. If the planned time is 0, it counts up like a stopwatch instead.
- **Warm-up sets:** set as a percentage of the working weight (and of the reduced weight in a deload week), rounded to weights you can load. You can use the default scheme, give an exercise its own scheme, or turn warm-ups off.
- **Tempo for each exercise:** optional, written as lower–pause–lift–pause seconds (e.g. `3-1-2-0`, with `X` for explosive). It stays the same in deload weeks and appears in history and the CSV.
- **Metronome** (tap ♩ Metronome on an exercise, or at the top of a workout), with two modes:
  - **Tempo:** guides each rep with a different sound for lowering, pausing and lifting, shows the current phase and rep, and can stop automatically after the set's planned reps. It can also say the rep numbers out loud.
  - **Steady beat:** a plain click at the speed you set, in beats per minute.
  - A start delay you choose in Settings (default 5 seconds) gives you time to put the phone down. Quiet ticks count down the delay.
  - **Hide** keeps it running and shows a small bar at the top of the screen with a Stop button.
- **Progress charts** for each exercise: top weight, estimated 1-rep max, volume, reps or time. You can hide deload weeks.
- **CSV export** for Google Sheets (one row per set), plus a **full backup and restore** file.
- **Dark mode:** automatic, or choose light or dark in Settings.

## Putting it on your iPhone

1. **Host it (one time).** On GitHub, open the repo → **Settings → General** and make sure the repository is **Public**. Then go to **Settings → Pages** → *Build and deployment* → Source: **Deploy from a branch**. Pick the branch that holds this code (e.g. `main`), folder **/ (root)**, and click **Save**. After a minute or two the page shows your link, e.g. `https://ekoile.github.io/fitness/`.
2. **Install it.** Open that link in **Safari** on your iPhone, tap the **Share** button, then **Add to Home Screen**.
3. **Use it from the Home Screen icon.** After the first open it works with no internet at all.

> Use the Home Screen app, not a Safari tab. The installed app keeps its own data, separate from Safari.

### Exporting to Google Sheets
History → **Export CSV** → in the Share sheet choose **Save to Files** (or the Google Drive app). Then in Google Sheets: **File → Import → Upload**.

### Backups
Your data lives only on the phone. Use Settings → **Back up everything** now and then, and save the file to iCloud Drive or Files. **Restore from backup** brings everything back, for example on a new phone.

## iPhone limitations

- The rest timer can't send a lock-screen alert. While the app is closed the timer keeps counting, and it catches up as soon as you open the app again.
- The metronome stops if you lock the phone or switch apps. The app keeps the screen on during workouts so this doesn't happen in normal use.
- The ring/silent switch can mute the timer and metronome beeps. iPhone web apps can't vibrate.

## Development

Plain HTML/CSS/JavaScript with no build step and no dependencies.

```sh
npm test          # unit tests for the deload, warm-up, cycle, tempo, CSV and backup logic
npm run serve     # serves the app at http://localhost:8080
```

When you change any app file, bump `VERSION` in `sw.js`. That makes installed phones download the update; the app then shows an "update ready" message.
