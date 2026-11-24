# Dark Store Blitz

A live competition game for 50 to 200 teams. Teams play on their phones, the organiser runs the game from a laptop
and shows it on a projector. Teams first stock a small warehouse, then walk orders through it: less walking, more points.

It needs **Node.js 20** and nothing else. No `npm install`, no internet, no outside files.

How to run the event, every control, the rules and the scoring: see **[CONTROLS.md](CONTROLS.md)**.

## Run it

```
node server.js
```

Keep the Terminal window open. It prints:

- the organiser screen: `http://localhost:3001/host`
- the organiser PIN
- the address players type on their phones (the laptop's address on the Wi-Fi, port 3001)

Stop with `Ctrl + C`. The game is saved first.

### Settings (environment variables)

| Name | Default | What it does |
|---|---|---|
| `PORT` | `3001` | The port the server listens on (on all network addresses). |
| `HOST_PIN` | 6 random digits, kept in the save file | The organiser PIN. Set it yourself so you know it before the event. |
| `SAVE_FILE` | `blitz-save.json` next to `server.js` | Where the game is saved. |
| `TEAMS_PER_ADDRESS` | `5` | How many NEW teams one phone may create. `0` = no limit. The game laptop itself is never limited. |

Example:

```
HOST_PIN=482913 PORT=3001 node server.js
```

### Saving and restarting

- The game is written to the save file about once a second when something changed (first to a temp file, then swapped in).
- Start the server again and it picks the game up: teams, layouts, scores, organiser logins.
- If a clock was running when the server stopped, it comes back **paused**. Press Resume on the organiser screen.
- A save file that cannot be read is renamed to `blitz-save.json.corrupt-<number>` and a new game starts.
- For a clean start: use "Reset the whole game" in the control room, or stop the server and delete the save file.

### Network

All phones must reach the laptop. A laptop or phone hotspot cannot carry 200 phones: use a venue router, or run the
server on an online host (Node 20, one instance, long-lived connections allowed, `PORT` and `HOST_PIN` set).

## Tests

```
node --test test/
```

- `test/game.test.js` checks the rules in `game.js` and the round list in `rounds.js`.
- `test/server.test.js` starts the real server on a spare port with a throw-away save file and checks what phones may see and when, wrong-PIN protection, the hidden podium, the "too fast" flag and coming back after a crash.

## Load test

Start the server, then in a second Terminal window:

```
node tools/loadtest.js --url http://localhost:3001 --pin <organiser PIN> --smoke
node tools/loadtest.js --url http://localhost:3001 --pin <organiser PIN> --teams 200 --phones 2 --reset
```

It plays a whole game with bot teams and checks the server's sums. Exit code 0 = everything matched.

| Switch | Meaning |
|---|---|
| `--smoke` | 5 teams, fast. |
| `--teams 200` | Number of bot teams (1 to 300). |
| `--phones 2` | Phones per team (1 to 10). |
| `--rounds 6` | Play only the first 6 orders (`all` = every round). |
| `--window 5000` | Bots hand in within this many milliseconds. |
| `--layout-ms 15000` | How long bots take to stock their shelves. |
| `--seed 42` | Repeat the same random choices. |
| `--reset` | Wipe the game before AND after the run. Without it the tool refuses to touch a game that already has teams. **Never use it on a real competition.** |

By default one address may only create 5 teams, and the load test comes from one address. This is no problem when the
load test runs on the game laptop itself (the laptop is never limited). From another machine, start the server with
`TEAMS_PER_ADDRESS=0` for the test.

## File map

| File | What it is |
|---|---|
| `server.js` | The game server: web server, live streams, actions, scoring, saving. |
| `game.js` | The rules, shared by the server and the browsers: map, products, routes, penalties, scoring. Phones get it without the route solver. |
| `rounds.js` | Server-only secrets: Round 1 length, sales per hour, and the 16 rounds. Never sent to browsers. Edit it and restart to change the competition. |
| `public/player.html`, `player.js`, `player.css` | The phone screen (served at `/`). |
| `public/host.html`, `host.js`, `host.css` | The organiser screen (served at `/host`). |
| `public/kit.js`, `kit.css` | Shared browser toolkit: live connection, flat map, clock, sounds, toasts, confetti. |
| `public/kit3d.js` | The 3D warehouse map (plain CSS 3D) for the projector and for result replays. Falls back to the flat map on slow devices. |
| `test/game.test.js`, `test/server.test.js` | Tests. |
| `tools/loadtest.js` | Load test with bot teams. |
| `preview-3d.html` | A stand-alone preview page for the 3D map. Not served by the game server. |
| `old-version/` | The earlier single-file version, kept for reference only. |
| `blitz-save.json` | The saved game. Made by the server when it runs. |
| `CONTROLS.md` | Organiser guide: controls, rules, scoring, run sheet, troubleshooting. |

## How the pieces talk

- `GET /` and `GET /host` serve the two screens. Only a fixed list of files can be fetched; `rounds.js` and the save file are not on it.
- `POST /api` with a JSON body `{a: '<action>', ...}` does things (join, place a product, hand in a route, start a round).
- `GET /events?k=<key>` is a live stream. The server pushes a fresh "view" whenever something that screen may see has changed. If the stream fails, the screens fall back to asking every few seconds.
- `GET /export.csv?k=<organiser key>` is the final table. `GET /healthz` answers `ok`.

## Before a competition (do this the day before, not on the day)

1. **Secret orders and organiser PIN.** `rounds.js` is public, so it is only the practice set. The real orders are in
   `rounds.secret.js`, which is never uploaded. Edit it if you like, then run `node tools/secret-orders.js`. It checks
   the orders and writes `render-secrets.txt` with two lines: `HOST_PIN` and `ROUNDS_B64`. Paste both into
   Render > dark-store-blitz > Environment and save. Saving restarts the server, so never do it during the game.
2. **Check it.** Open `/host`, sign in with the new PIN, open the Control room. The Safety section must show two ticks:
   secret orders loaded, PIN not the default.
3. **Do not push to GitHub and do not change Render settings during the game.** Both restart the server.

## If the server restarts during the game

Render's free plan forgets the save file on a restart, so the server comes back with an empty lobby. The organiser
screen keeps a safety copy of the whole game in its browser (refreshed every few seconds) for exactly this.

- Keep ONE organiser screen open for the whole game, in the same browser.
- After a restart that screen asks for the PIN again, then says "The game server restarted" and offers to put the game
  back. Press **Put the game back**. Teams, layouts, scores and team PINs return; a running clock returns paused.
- Phones wait by themselves (up to 5 minutes) and carry on after the restore. Nobody has to join again.
- Extra belt: Control room > Safety > **Download safety copy** after each stage. **Restore from a file** puts it back
  from any laptop.
