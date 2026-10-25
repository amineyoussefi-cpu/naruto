# Agent: UI v4 (character select, charge meter, six-arrow sequence, help)

**You own:** `src/ui/*`, `src/config/settings.ts` (UI_CONFIG / limits only; `Settings.character` already exists),
`tests/unit/settings*.test.ts`, new `tests/unit/qte-ui*.test.ts` if useful. Text in French.
Read: `prompts/01-shared-rules.md`, `prompts/30-update-v4.md`, `src/ui/*`, `src/game/Game.ts` (`GameApi`: `character`,
`selectCharacter`, `qteInput`, `applySettings`), `src/core/types.ts` (`HudData`, `QteState`), `src/core/input.ts` (`KEY_LABELS`
incl. `grab`), `src/config/characters.ts`.

Deliver:
1. **Character selection**: after "Jouer", a selection screen (before the controls card) with three cards Naruto / Sasuke / Kakashi
   (name, colour accent, special name and `blurb`), keyboard + mouse selectable, ids `#char-naruto`, `#char-sasuke`, `#char-kakashi`,
   confirm `#btn-char-confirm`. Selecting calls `game.selectCharacter(id)` and persists via the settings store (`settings.character`
   + `applySettings`). Show the current character on the main menu. Also reachable from victory/defeat (button "Changer de
   personnage") without reloading.
2. **HUD**: chakra bar works with 300 max (values from HudData — check the numbers fit); the special slot shows the label from
   HudData (Rasengan / Sharingan / Chidori) and greys out on cooldown/insufficient chakra; a **charge meter** around/below the reticle
   while `charge` is set (filling ring, colour blue for Rasengan / white-blue electric for Chidori, "MAX" flash at level 1).
3. **Six-arrow sequence overlay** (`#qte` shown while `hud.qte` not null): six arrow buttons (`#qte-arrow-0`..`#qte-arrow-5`,
   glyphs ↑ ↓ ← →, big, clickable — `pointer-events:auto`; clicking calls `game.qteInput(dir)` for the **clicked button's own**
   direction only if it is the next one, otherwise report the click direction anyway so combat can count it as a miss — simplest:
   every arrow button sends its direction; combat validates), highlight the next expected arrow, done arrows ✓ green, a wrong one ✗
   red shake, a timer bar from `timeLeft/timeTotal`, outcome banner on `done` ("Enchaînement parfait !", "Raté !", "Trop tard !",
   "Interrompu"). The cursor is free during the sequence (Game handles pointer lock). Make sure clicks on the overlay don't reach the
   canvas (stopPropagation) and the overlay hides when `qte` becomes null.
4. **Help / tutorial**: controls card and help list updated: hold E (charge/release — per character text from `CHARACTERS`),
   grab = left + right click together then click the arrows in order, automatic wall climbing (run into a wall), double-tap W boost,
   chakra dash, substitution. README is the lead's.
5. Settings test: `character` validation (bad/missing values fall back to naruto).
Responsive down to 1024×600; keep existing ids used by e2e tests (`#btn-play`, `#btn-start-fight`, `#hud`, `#hud-wave`, `#pause-menu`,
`#btn-resume`, `#victory-screen`, `#btn-retry`, `#defeat-screen`, `#btn-defeat-menu`). Note `#btn-play` must still lead (through the
new selection screen) to `#btn-start-fight`: tell me in your report the exact click path so I can update the e2e test.
