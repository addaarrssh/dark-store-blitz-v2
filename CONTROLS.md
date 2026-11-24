# Dark Store Blitz - controls, rules and run sheet

This page is for the organiser. It lists every control that really exists in the game, the rules and the scoring,
a plan for competition day, and what to do when something goes wrong.

Two screens:

- **Organiser screen** - `http://localhost:3001/host` on the game laptop. Put this on the projector. It asks for the organiser PIN, which is printed in the Terminal window when the server starts.
- **Player screen** - the address shown in the lobby (for example `http://192.168.1.20:3001`). Teams open it on their phones.

---

## A. Organiser controls

### A1. What the organiser screen is made of

| Part | Where | What it is |
|---|---|---|
| Top bar | top | Game name, what is happening now, flags (`PRACTICE MODE`, `NO CLOCK`, `JOINING LOCKED`), number of teams and phones, and a connection dot (green = live). |
| Message bar | under the top bar | The message you sent to all phones, if any. |
| Pause bar | under the top bar | "CLOCK PAUSED" while the clock is frozen. |
| Stage | middle | What the hall reads: join address, clock, order ticket, results, podium. |
| Bottom bar | bottom | The buttons for the current step. The **yellow** button is always the normal next step. |
| Control room | slides in from the right | Jump to a round, settings, message, team table, danger zone. Open it with **☰ Control room**. |

### A2. Keyboard shortcuts

| Key | What it does |
|---|---|
| `N` | Presses the yellow "next step" button in the bottom bar. |
| `Space` | Pause or resume the clock (only in Round 1 or during an order, and only if the clock is on). |
| `F` | Full screen on or off. |
| `Esc` | Closes a question box, the help box or the control room. |
| `Enter` | Says "yes" in a question box. |

Keys do nothing while you are typing in a text field. `N` and `Space` do nothing while a question box is open.

**`N` always asks first.** "Next", "Start Round 1", "Start Order 1", "Final results" and each podium reveal open a question box ("Start Order 4?"). **Enter** = yes, **Esc** = "Not yet". Pressing `N` again does nothing, so a stray key press cannot start a round. In the lobby, **Show rules** (key `R`) puts the full rules on the projector; it is only available before Round 1 starts.
screen the yellow button asks before it acts (except "Reveal place" on the podium).

Sounds on the organiser screen only work after one click or key press on the page.

### A3. Bottom bar, step by step

**Always there (right side)**

| Button | What it does |
|---|---|
| 🔊 Sound on / 🔇 Sound off | Sounds of this screen on or off. |
| ⛶ Full screen `F` | Fills the whole screen. Use it on the projector. |
| ☰ Control room | Opens or closes the control room. |

**Lobby (teams are joining)**

| Control | What it does | When to use |
|---|---|---|
| Round 1 length | Pick 5 to 60 minutes. The normal length is 30 minutes. | Before you press Start. |
| ▶ Start Round 1 `N` | Opens the warehouse on every phone and starts the Round 1 clock. Asks first. | When the teams are in and the rules are explained. |
| 🔒 Lock joining / 🔓 Open joining | Stops or allows NEW teams. Phones of teams already in can always come back. | When all teams are in, so nobody makes joke teams. |

**Round 1 (teams build their store)**

| Control | What it does | When to use |
|---|---|---|
| +1 min / −1 min | Adds or removes one minute. If −1 min would end the round, you are asked first. | The room needs more or less time. |
| ⏸ Pause clock / ▶ Resume clock `Space` | Freezes the clock for everybody. Teams can still work. | Announcements, technical trouble. |
| Show / Hide sales per hour | Shows how often each product is sold, on the projector and on every phone. | A hint: fast sellers should sit close to START. Decide before the event if you give it. |
| 🔒 Lock layouts now `N` | Ends Round 1 at once. Layout mistakes are counted now. Asks first and tells you how many teams are not finished. | All teams are done early. (If you do nothing, the clock locks the layouts by itself.) |

**Layouts locked (layout check on the projector)**

| Control | What it does | When to use |
|---|---|---|
| ▶ Start Order 1 `N` | Sends the first order to every phone and starts its clock. Asks first. After this, layouts can never be reopened. | After you have talked through the layout check. |
| ↩ Reopen layouts for 5 min | Gives every team 5 more minutes to fix its store. Only possible before the first order. Penalties are counted again afterwards. | Many teams did not finish. |

**An order is running**

| Control | What it does | When to use |
|---|---|---|
| +30 s | Adds 30 seconds. | The room needs a little more time. |
| ⏸ Pause clock / ▶ Resume clock `Space` | Freezes the clock. Teams can still walk and hand in. | Trouble in the room. |
| ⏹ End order now `N` | Closes the order early. Teams that have not handed in get 0 for it. Asks first and tells you how many teams are missing. | Everybody has handed in. (If you do nothing, the clock ends the order by itself.) |

**Results of an order**

| Control | What it does | When to use |
|---|---|---|
| ▶ Next: Order … `N` | Starts the next order that was not played yet. **Asks first** ("Start Order 4?" - Enter = yes, Esc = Not yet). Surprise rounds are shown as "Surprise round" so the hall cannot read the name early. | When the room is ready. |
| ↻ Replay best run | Plays the best route of this round again on the map. | To explain why that route was good. |
| 🏁 Final results | Ends the game early and opens the podium. Asks first. | Only if you run out of time. |

When all 16 rounds are played, the yellow button becomes **🏁 Show final results**.

**Final results**

| Control | What it does |
|---|---|
| Reveal 3rd place → Reveal 2nd place → 🏆 Reveal the WINNER `N` | Shows one podium place at a time, on the projector and on every phone at the same moment. The button rests for 1.5 seconds after each press so a double click cannot show two places. |
| 🎉 More confetti | Appears when the podium is complete. |
| ⬇ Download results (CSV) | Saves the final table as a file for Excel: rank, team, points, meters, penalties, adjustments, then one column per round. |

### A4. Control room

**Jump to a round** - one button per round, plus "🏁 Final results". Pink = running now, a tick = already played.
Surprise rounds that were not played yet are named "Surprise 11", "Surprise 12" and so on. You are always asked before a round starts.
If the round was played before, you are asked a second time: "Play it again and wipe its old scores?". If another order is
running, it is closed first. The buttons are greyed out until the layouts are locked.

**Settings** (four switches)

| Switch | What it does | When to use |
|---|---|---|
| Clock: ON / OFF | OFF = "no clock": rounds only end when you end them. Switching it back ON restarts the clock of the running round from its full time. Asks first. | OFF for demos and teaching. ON for the competition. |
| Practice mode: ON / OFF | ON = teams get a "Try again" button and can retry an order as often as they like. Asks first when switching on. | Practice only. **Keep OFF in the competition.** |
| Joining: ON / OFF | Same as Lock joining / Open joining. | Lock it when all teams are in. |
| Sales per hour: ON / OFF | Same as Show / Hide sales per hour. | Your choice of hint. |

**Message to every phone** - type up to 140 letters and press **Send**. The message shows on all phones and on the projector.
**Clear** takes it away. A player can tap the message to hide it on their own phone.

**Teams table** - one line per team: rank, name, phones connected, products placed (out of 24), points, layout penalty, and the result of the current round.

- **Search** by team name. **Sort by** rank, name, products placed, phones, penalties, or this round (teams that have not handed in come first).
- **Click a team line** to see its penalty reasons, its point adjustments and its total meters.
- In the "This round" column: ⭐ = perfect route, ⚡ = speed bonus, "cart" / "2 trips" / "1 trip only" for the double drop.
- **⚠ too fast** = the hand-in arrived faster than a person can tap it (under 1.5 seconds plus 0.1 second per step). It counts, but it got no speed bonus. Go and look at that team.

| Button | What it does | When to use |
|---|---|---|
| ± Points | Adds or takes away points for one team (whole number from −1000 to 1000, not 0) with a reason of up to 60 letters. The team sees the points and the reason on its phone. | A fair fix after a dispute, or a rule break. |
| Redo | Deletes that team's result for the current order. While the order is running the team can hand in again. After the order is closed the team simply has 0 for it. | Dispute while the order is still running. |
| New PIN | You type 4 new digits for a team that forgot its PIN. Phones that are still connected stay in. It also lifts any "too many wrong PINs" block for that team. The box is visible on the projector, so cover it. | A team cannot get back in. |
| Remove | Deletes the team, its layout and its score, and signs its phones out. Cannot be undone. | Joke teams, double teams. |

**Danger zone**

| Button | What it does |
|---|---|
| 🗑 Reset the whole game… | Wipes all teams, layouts and scores and goes back to an empty lobby. All phones are signed out. You are asked twice and must type `RESET`. The organiser PIN stays. |
| Sign out of this screen | This browser forgets the organiser login. The game keeps running. |

**? Controls help** (top of the control room) opens a short list of all controls on the screen itself.

---

## B. What a participant can do

### Join screen
- Type a **team name** (2 to 24 letters) and **any 4-digit PIN**, then **Join the game**.
- Teammates join on their own phones with the **same name and the same PIN**. Capital letters do not matter.
- A new team can only be made in the lobby or during Round 1, and only while joining is open. Joining an existing team with the right PIN works at any time.
- A typo in the name makes a NEW team. The phone then shows "You started a NEW team" with two buttons: **This is right** or **Join another team**.
- Wrong PINs: 6 wrong tries from one phone for one team = wait 1 minute. 10 wrong tries for one team name from anywhere = that name is closed for 5 minutes (the organiser can fix this with New PIN).
- The phone remembers its team. Closing and opening the page brings the team back without typing again.

### Always on the phone
- Top bar: connection dot, team name, points (after layouts are locked), **Rules** button in the lobby / **Help** button from Round 1 on, PAUSED sign, clock.
- **Rules** (lobby only) opens the full rules with the penalty list. From Round 1 on it becomes **Help**: only how to use the screen, walking and points - no placing rules, no penalties. Inside both: **Sound: on/off** and **Use another team on this phone**.
- A message from the organiser shows under the top bar. Tap it to hide it.
- A strip says "Reconnecting… you can keep playing" or "No connection" when the link is bad.

### Lobby
- "You are in", number of phones connected for the team, number of teams so far, a small moving demo and the rules.

### Round 1: stock your store
- Tap a shelf square, choose the product, then tap a level (Top, Middle, Bottom). Tapping the level saves it.
- Choosing a product that is already somewhere else moves it. **Empty this shelf** takes a product off.
- Tap a product in the list "Your 24 products" to find it or to place it.
- The phone does NOT coach: no "would cost" hints, no live penalty list, no warning marks while stocking. Product tags (COLD, CHEMICAL, FRAGILE, HEAVY) and zone colours stay. Penalties are shown only after layouts are locked. The phone also keeps its screen awake during the game (needs https or localhost; over plain http on Wi-Fi the phone may still lock).
- All teammates can place at the same time. The layout is shared.
- If the organiser shows sales per hour, each product shows its number.

### Layouts locked
- The team sees its penalties, the products it did not stock, and its store. Tap a shelf to see what is on it. Nothing can be moved.

### An order
- The order list shows each item and where the team stocked it.
- Tap a walkway square to walk there. Tap a pink shelf to walk next to it and grab the item. Then walk back to START (A3).
- Bottom bar: **Clear** (wipe the route; Undo brings it back), meters so far and the points at that distance, **Undo** (one tap back), **Hand in**.
- One hand-in per team per order. Any teammate can do it. The other phones then show "A teammate handed in for your team".
- The route being drawn is kept on the phone, so a page refresh does not lose it.
- If an item was never stocked, that order (or that trip) scores 0 and cannot be walked.
- **Double drop:** choose **Plan A: two trips** or **Plan B: one big trip**. In Plan A switch with the tabs **Trip 1 / Trip 2**. **Change plan** goes back. Handing in with one trip unfinished needs a second tap ("Sure? Hand in").
- After handing in: meters, points and bonuses are shown, then "Waiting for the buzzer".
- In practice mode only: **Try again (practice mode)**.
- While an order runs, nobody sees a rank or a leaderboard.

### Results of an order
- Points for the round with bonuses, own route replayed on the map (in 3D if the phone can do it smoothly, else flat), **Watch again**, the shortest possible route for the team's own layout as a dashed line, room numbers (handed in, perfect routes, average and shortest walk), the team's rank and the top 10.

### Final results
- Rank, points, meters, penalties. Teams on the podium only see "TOP 3" until the organiser reveals their place on the big screen. The top places in the leaderboard show "? ? ?" until then.

---

## C. Rules and scoring

### The warehouse
- A 10 × 10 grid, rows A to J, columns 1 to 10. START is **A3**. Every trip starts and ends there.
- One square walked = 1 meter. You walk only on walkway squares. To pick an item, stand on a walkway square that touches its shelf. Picking costs nothing.
- 24 products. One product per shelf square, on the Top, Middle or Bottom level.
- Cold zone: J1 to J3. Chemical zone: J8 to J10. Spare shelves: J4 to J6.

### Layout penalties (counted once, when the layouts are locked)

| Mistake | Points lost |
|---|---|
| Cold product (Cornetto, Frozen Peas, Greek Yogurt) outside J1 to J3 | −75 each |
| Chemical (Harpic, Surf Excel, Mosquito Refill) outside J8 to J10 | −50 each |
| Food in the chemical zone | −50 each |
| Heavy product (Atta 5kg) not on the bottom level | −30 |
| Fragile product (Bread, Eggs, Chips, Olive Oil) on the bottom level | −30 each |
| Eggs right next to Atta | −30 |

Mistakes add up (a cold product put in the chemical zone loses 75 + 50). Non-food that may sit in the chemical zone:
Handwash, Harpic, Colgate, Surf Excel, Batteries, Band-Aid Kit, Mosquito Refill.
A product that was never placed has no penalty, but every order that needs it scores 0.

### Points for one order
- **Route points = 150 − 2 × meters walked** (never below 0).
- **Speed bonus +10** for the first teams to hand in: the first 3, or the first 10% of all teams if that is more (rounded up). With 200 teams that is the first 20. A "too fast" hand-in gets no speed bonus and does not use up a place.
- **Perfect-route bonus +20** if the team's route points are as good as the best possible for **its own layout**. So a team with a poor layout can still get it.
- **Round total = route points + speed bonus + perfect bonus.** No hand-in = 0.

### Team total and ranking
- **Total = all round totals + organiser adjustments − layout penalties.**
- Ranking: most points first. On a tie, the team that walked fewer meters in total. Then by name.

### The 16 rounds

| # | Round | Items | Clock |
|---|---|---|---|
| 1-2 | Order 1, Order 2 | 3, 4 | 2:30 each |
| 3-4 | Order 3, Order 4 | 4 | 2:15 each |
| 5-6 | Order 5, Order 6 | 4 | 2:00 each |
| 7-8 | Order 7, Order 8 | 4, 5 | 1:45 each |
| 9-10 | Order 9, Order 10 | 5 | 1:30 each |
| 11-12 | Oil spill 1 and 2 | 4 | 2:30 each |
| 13-14 | Pallet crash 1 and 2 | 4, 5 | 2:30 each |
| 15 | Double drop | 4 + 4 | 4:00 |
| 16 | Final boss | 6 | 4:00 |

The orders themselves are secret (they live in `rounds.js`, which is never sent to phones).

### The crises (rounds 11 to 16)
- **Oil spill (2 rounds):** aisle 6 is one-way. You may only walk down it (from B6 towards I6), never back up.
- **Pallet crash (2 rounds):** some walkway squares are blocked. First B4 and B5, then B4, B5, B7 and B8. Walk around them.
- **Double drop:** two orders at once.
  - Plan A, two trips: each trip scores 150 − 2 × its meters. A team may hand in only one trip; the other then scores 0.
  - Plan B, one trip with a heavy cart: meters = steps × 1.25 (rounded up), points = 300 − 2 × those meters. Only possible if all items of both orders are stocked.
- **Final boss, double points:** oil spill in aisle 6 AND pallets on B4 and B5 together. The route points are doubled: (150 − 2 × meters) × 2. The speed bonus (+10) and the perfect bonus (+20) are not doubled.

---

## D. Competition day

### Pre-event checklist

The day before:
- [ ] Node.js 20 is on the game laptop. `node --test test/` passes.
- [ ] **Network decided and tested.** A laptop or phone hotspot cannot carry 200 phones (most stop at about 10). Use a **venue router** that the laptop and all phones join, or put the game on an **online host** so phones use their own mobile data. The game needs no internet itself, so a plain router with no internet is fine.
- [ ] If you use an online host: it must run Node 20, keep long-lived connections open (the live link is a stream), run as ONE instance (the game lives in memory), and you must set `HOST_PIN` yourself. The lobby then shows the web address by itself.
- [ ] Run the load test against the real set-up (see README) with about as many teams as you expect.
- [ ] **Test 3D on a few phones**, old and new, Android and iPhone: play one order in practice mode and watch the result replay. A phone that is too slow switches to the flat map by itself and stays flat, so nothing breaks, but it is good to see it once.
- [ ] Check the projector: organiser screen in full screen (`F`), join address readable from the back row, sound audible.

One hour before:
- [ ] Laptop on mains power, sleep and screen saver switched off.
- [ ] Start the server with a PIN you know: `HOST_PIN=<your pin> node server.js`. Keep the Terminal window open.
- [ ] If the load test or a rehearsal left teams behind: Control room → **Reset the whole game**.
- [ ] Control room → check **Practice mode: OFF** and **Clock: ON**. The top bar must show no `PRACTICE MODE` and no `NO CLOCK` flag.
- [ ] Open the player address on your own phone, join a test team, then **Remove** it.
- [ ] A second organiser can open `/host` on another device with the same PIN as a backup screen.

### Run sheet (about 2 hours)

The clock times come from the game. The talking time between rounds is a suggestion.

| Time | Step | What you press |
|---|---|---|
| 0:00 | Doors open. Lobby on the projector, teams join. | - |
| 0:10 | Explain the rules (put them on the projector with **Show rules**; phones show them only in the lobby). | **Lock joining** when everyone is in |
| 0:15 | **Round 1: build your store**, 30 minutes. | **Start Round 1**. Maybe **Show sales per hour**. |
| 0:45 | Layouts lock by themselves. Talk through the layout check. | (**Reopen layouts for 5 min** if many are unfinished) |
| 0:48 | **Orders 1 to 10.** 20 minutes of clock in total plus about 1 minute of results each. | **Start Order 1**, then **Next** after each result |
| 1:18 | Short break if you want one. | Send a message: "5 minute break" |
| 1:23 | **Surprise rounds 11 to 16.** 18 minutes of clock plus results. Read the crisis line aloud each time. | **Next** |
| 1:50 | **Final results.** | **Show final results**, then reveal 3rd, 2nd, winner |
| 1:55 | Save the table. | **Download results (CSV)** |

Short on time? Pick a shorter Round 1 (the list goes down to 5 minutes), or skip rounds with **Jump to a round**. Always play the Final boss last.

---

## E. When something goes wrong

**One phone is stuck or shows old things**
- Tell the player to refresh the page. The team, the layout and the route being drawn all come back.
- If the page asks to join again: same team name, same PIN.
- "Too many wrong PINs" or the PIN is forgotten: Control room → team line → **New PIN**.
- The phone joined a wrong (new) team by a typo: on the phone, Rules/Help → **Use another team on this phone**, join the right one, then **Remove** the stray team.
- The 3D replay stutters: nothing to do. The phone switches to the flat map by itself.

**Wi-Fi drops for the room**
- Press **Pause clock** (`Space`) at once. Nobody loses time while paused.
- Phones show "Reconnecting…" or "No connection" and come back by themselves when the Wi-Fi is back. Routes being drawn are kept on the phones.
- When the phone count in the top bar is back to normal, press **Resume clock**. Add time with **+30 s** or **+1 min** if needed.
- A team could not hand in because of the drop: replay the round for everybody (**Jump to a round** → wipe and replay), or give that team points with **± Points**.

**The organiser screen says "NO CONNECTION" or the dot turns pink**
- The screen keeps the last state and reconnects by itself. If it does not, refresh the page. Check that the Terminal window with the server is still open.

**The game laptop restarts or the server stops**
- Start it again: `HOST_PIN=<your pin> node server.js` in the same folder. The game is picked up from the save file (`blitz-save.json`) with all teams, layouts and scores.
- **The clock comes back PAUSED.** The time left is what it was at the last save (at most about 5 seconds old), and never less than 30 seconds. Press **Resume clock** when the room is ready.
- Phones and the organiser screen reconnect by themselves. If you start with a different `HOST_PIN` than before, the organiser must type the PIN again.
- The laptop's network address may have changed after a restart. Check the address in the Terminal window. If it changed, phones must open the new address and join again with the same team name and PIN.
- If the save file is damaged, the server starts a new game and keeps the bad file as `blitz-save.json.corrupt-<number>`.

**"The game is already running in another Terminal window"**
- The port is busy. Close the other window, or start with another port: `PORT=3002 node server.js`.

**A team disputes its score**
1. Control room → click the team line. You see its penalties with reasons, its adjustments, and for the current round its meters, points, ⭐ and ⚡. On the results screen you also see "(best … m)", the shortest route its layout allowed.
2. The order is still running: **Redo** deletes the result and the team hands in again.
3. The order is closed: use **± Points** with a clear reason. (Redo now would only set the round to 0.)
4. The whole round went wrong for everybody: **Jump to a round**, choose it again and confirm "wipe and replay".
5. Layout penalties cannot be changed after the first order. Correct them with **± Points** if you agree with the team.

**A round was started by mistake**
- **End order now**, then **Jump to a round** to the right one. A round started by mistake can be played again later; you are asked to wipe its old scores.

**Somebody guesses the organiser PIN**
- 8 wrong tries from one device block that device for 1 minute. 40 wrong tries from the whole room in one minute block everybody for 1 minute, except the game laptop itself.
