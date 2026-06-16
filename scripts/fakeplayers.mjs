// Fill a LIVE lobby with N fake players (random name + Saudi phone + region)
// so they show up in the host panel / winners page. Each player joins and the
// socket is closed immediately — the player stays in the session server-side,
// so this does NOT hit the per-IP concurrent-connection cap.
//
// Usage:
//   1) Open /host → log in → Create Session → open the display.
//      Copy the session id from the URL  …/display?s=<SESSION_ID>
//      Leave it in the LOBBY (don't press Start).
//   2) SESSION=<id> node scripts/fakeplayers.mjs 500 https://aljeel-omq.up.railway.app
//
// Env: SESSION (required), CONCURRENCY (default 30).
import { io } from "socket.io-client";

const N = parseInt(process.argv[2] || process.env.COUNT || "500", 10);
const URL = process.argv[3] || process.env.URL || "http://localhost:5099";
const SESSION = process.env.SESSION || "";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "30", 10);
const REGIONS = ["riyadh", "jeddah", "khobar"];

const FIRST = ["Ahmed","Mohammed","Abdullah","Khalid","Fahad","Sultan","Faisal","Omar","Yousef","Saud",
  "Sara","Noura","Fatima","Maha","Reem","Lama","Hala","Aisha","Maryam","Joud",
  "Nasser","Turki","Bandar","Majed","Ziad","Hassan","Hussain","Tariq","Salman","Waleed"];
const MIDDLE = ["bin Ali","bin Saad","bin Nasser","Abdulaziz","Ibrahim","Mansour","Saleh","Hamad","Rashed","Khalil",
  "Abdulrahman","Sami","Adel","Fawaz","Naif","Talal","Bader","Riyad","Mishari","Anas"];
const LAST = ["Alharbi","Alqahtani","Alotaibi","Alshehri","Alghamdi","Aldosari","Almutairi","Alzahrani","Alanazi","Alshammari",
  "Albalawi","Alomari","Alsubaie","Alrashidi","Aljuhani","Alasmari","Alyami","Almalki","Albishi","Alqurashi"];

const seenNames = new Set();
function randInt(n) { return Math.floor(Math.random() * n); }
function uniqueName() {
  for (let i = 0; i < 50; i++) {
    const n = `${FIRST[randInt(FIRST.length)]} ${MIDDLE[randInt(MIDDLE.length)]} ${LAST[randInt(LAST.length)]}`;
    if (!seenNames.has(n)) { seenNames.add(n); return n; }
  }
  const n = `Player ${seenNames.size + 1}`; seenNames.add(n); return n;
}
function saudiPhone() {
  let s = "05";
  for (let i = 0; i < 8; i++) s += randInt(10);
  return s;
}

function joinOne(i) {
  return new Promise((resolve) => {
    const sock = io(URL, { transports: ["websocket"], reconnection: false });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.close(); } catch {} resolve(ok); };
    const t = setTimeout(() => finish(false), 15000);
    sock.on("connect", () => {
      sock.emit("player:join",
        { sessionId: SESSION, name: uniqueName(), phone: saudiPhone(), region: REGIONS[randInt(3)] },
        (r) => { clearTimeout(t); finish(!!(r && r.success)); }
      );
    });
    sock.on("connect_error", () => { clearTimeout(t); finish(false); });
  });
}

async function main() {
  if (!SESSION) { console.error("ERROR: set SESSION=<sessionId> (from the /display?s=... URL)"); process.exit(1); }
  console.log(`\nAdding ${N} fake players to session ${SESSION.slice(0, 8)}… on ${URL}\n`);
  // show a few samples of the random data
  for (let k = 0; k < 3; k++) console.log(`  sample → ${uniqueName()} | ${saudiPhone()} | ${REGIONS[randInt(3)]}`);
  seenNames.clear();
  console.log("");

  let ok = 0, fail = 0, next = 0;
  async function worker() {
    while (next < N) {
      const i = next++;
      const r = await joinOne(i);
      if (r) ok++; else fail++;
      if ((ok + fail) % 50 === 0) process.stdout.write(`  ${ok} joined (${fail} failed)…\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n\nDone: ${ok} joined, ${fail} failed. Check the host panel — they should all be there.`);
  console.log(`(To clear them before the real event: Restart the game from /host or /winners.)\n`);
  process.exit(0);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
