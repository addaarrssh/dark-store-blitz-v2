DARK STORE BLITZ - how to run

ONE TIME
1. Install Node.js from nodejs.org (the LTS button).
2. Unzip, and move the "dark-store-blitz" folder to the Desktop.

EVERY TIME
1. Connect this laptop and all phones to the same Wi-Fi.
2. Open Terminal and run:
     cd ~/Desktop/dark-store-blitz
     caffeinate -i node server.js
3. Terminal shows the organiser link (http://localhost:3001/host), the host PIN and the player link.
4. Open the organiser link on the projector and enter the host PIN.
5. Players type the player link on their phones and join with a team name and a 4-digit PIN.
6. If macOS asks whether "node" may accept incoming connections, click Allow.

IF SOMETHING GOES WRONG
- A phone is stuck: refresh the page. If it asks to join again, use the same team name and PIN.
- Phones cannot open the link: the Wi-Fi is blocking them. Use a hotspot or a spare router instead.
- Terminal got closed: run the two commands again. The game continues from where it was.
- Start over completely: press "Reset game" on the organiser screen.

STOP AND CLEAN UP
- Press Ctrl + C in Terminal.
- Delete the dark-store-blitz folder and the zip. Nothing else is stored on the laptop.
