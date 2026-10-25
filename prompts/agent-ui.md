# Agent: HUD, menus, pause, settings

**You own:** `src/ui/*` (`UI.ts`, `styles.css`, new files), `src/config/settings.ts`, `index.html` (only inside `<head>` meta/
fonts-free and the `#ui` container; keep `#app`, `#ui`, `#loading` ids), tests `tests/unit/settings*.test.ts`.

Read first: `prompts/01-shared-rules.md`, `src/game/Game.ts` (`GameApi` is your only handle on the game — do not import other systems),
`src/core/types.ts` (`HudData`), `src/core/events.ts`, `src/core/input.ts` (`KEY_LABELS`), `src/main.ts`.

All text in **French**. Style: bold, readable, ninja-scroll flavour (orange/indigo/cream, brush-like headings using system fonts
only — no web fonts, no CDN). Pure DOM + CSS, no framework. `#ui` has `pointer-events:none`; enable on interactive panels.
`update(frameDt)` is called every frame: update the HUD from `game.getHudData()` cheaply (cache elements, only write changed values).

## Screens (show/hide by `game.state` and `stateChange` events)
- **Main menu** (`menu`): title "Shinobi Arena", buttons `#btn-play` "Jouer", `#btn-controls` "Commandes", `#btn-settings-main` "Paramètres".
- **Controls intro**: after Play, a short card listing all commands (from `game.keyLabels`, adapted to QWERTY/AZERTY) + goal
  ("Survivez aux 5 vagues"), button `#btn-start-fight` "Commencer" → `game.start()`. Also reachable from the menu and pause.
- **HUD** (`#hud`, `playing`): player HP bar (`#hud-hp`) and chakra bar (`#hud-chakra`) with numeric values and smooth trailing
  damage; chakra bar **shakes/flashes red** on `chakraFail` with a short message ("Chakra insuffisant"); concentration indicator;
  cooldown slots for each `cooldowns[]` entry (icon/label, key, radial or vertical sweep, greyed when `!usable`, chakra cost);
  wave counter `#hud-wave` ("Vague 2/5") and enemies remaining `#hud-enemies`; intermission countdown; wave banner on `waveStart`;
  lock-on target bar at top (`lockTarget`); floating enemy bars from `enemyBars` (absolute positioned, pooled divs; red pulse
  when `telegraph`, highlighted when `locked`); centre crosshair; red damage vignette when the player takes damage (`damage` event with
  `targetId` = player — compare with HUD hp drop if you can't know the id); optional FPS (`settings.showFps`); a hint
  "Cliquez pour reprendre le contrôle de la caméra" is not needed (game pauses on pointer-lock loss).
- **Pause** (`paused`, `#pause-menu`): `#btn-resume` Reprendre, `#btn-restart` Recommencer, `#btn-settings` Paramètres,
  `#btn-controls-pause` Commandes, `#btn-menu` Menu principal. Escape is handled by the game (toggles pause).
- **Settings** (`#settings-panel`): master volume `#settings-volume` (range), camera sensitivity `#settings-sensitivity`, invert Y,
  keyboard layout (Auto/QWERTY/AZERTY), show FPS. Changes apply live via `game.applySettings` and persist to
  `localStorage[SETTINGS_STORAGE_KEY]` — wrap every storage access in try/catch, validate/clamp loaded values (trust boundary).
  Load saved settings at UI construction and apply them.
- **Victory** (`#victory-screen`) / **Defeat** (`#defeat-screen`): message, stats if available (waves cleared), `#btn-retry`
  Recommencer (→ `game.restart()`), `#btn-victory-menu` / `#btn-defeat-menu` Menu principal.
- Buttons must call `game.userGesture()` indirectly through start/resume/restart (they already do). Keyboard accessible
  (focus styles, Enter activates), sufficient contrast, responsive down to 1024×600.

Put settings load/validate/save in a pure module (`src/ui/settingsStore.ts`) and unit-test it (bad JSON, out-of-range values,
missing storage).
