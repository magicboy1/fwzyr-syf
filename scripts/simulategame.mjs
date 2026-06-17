// Full game simulation: N fake players REGISTER (name/phone/region), stay
// connected, and ANSWER every question with random timing + skill — so they
// behave like real players and produce a real leaderboard. The script also
// acts as the host and drives the game start→questions→end.
//
// Watch it live: open the printed /display?s=... URL, and /winners after.
//
// Usage:
//   node scripts/simulategame.mjs [players] [url]
//   PLAYERS=400 Q_TIME=12 node scripts/simulategame.mjs 400 https://aljeel-omq.up.railway.app
//
// Note: players HOLD connections (like real players), so from one machine this
// is capped by the per-IP limit (~400 on Railway). That's the realistic load
// pattern — watch Railway Metrics (memory) while it runs.
import { io } from "socket.io-client";
import { readFileSync } from "fs";

const N = parseInt(process.argv[2] || process.env.PLAYERS || "400", 10);
const URL = process.argv[3] || process.env.URL || "http://localhost:5099";
const Q_TIME = parseInt(process.env.Q_TIME || "12", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "40", 10);
const LETTERS = ["A", "B", "C", "D"];
const REGIONS = ["riyadh", "jeddah", "khobar"];

let RAW;
try { RAW = JSON.parse(readFileSync("data/questions.json", "utf-8")); } catch { RAW = []; }
if (!Array.isArray(RAW) || RAW.length === 0) {
  RAW = [{ id: "q1", text: "Sample?", options: ["a", "b", "c", "d"], correct: "A" }];
}
const QS = RAW.map((q) => ({ ...q, timeLimit: Q_TIME }));

const FIRST = ["Ahmed","Mohammed","Abdullah","Khalid","Fahad","Sultan","Faisal","Omar","Yousef","Saud","Sara","Noura","Fatima","Maha","Reem","Lama","Hala","Aisha","Maryam","Nasser","Turki","Bandar","Majed","Ziad","Hassan","Tariq","Salman","Waleed"];
const LAST = ["Alharbi","Alqahtani","Alotaibi","Alshehri","Alghamdi","Aldosari","Almutairi","Alzahrani","Alanazi","Alshammari","Alomari","Alsubaie","Alrashidi","Aljuhani","Alasmari","Alyami","Almalki","Alqurashi"];
const seen = new Set();
const ri = (n) => Math.floor(Math.random() * n);
const uname = () => { for (let i = 0; i < 60; i++) { const n = `${FIRST[ri(FIRST.length)]} ${LAST[ri(LAST.length)]}`; if (!seen.has(n)) { seen.add(n); return n; } } const n = `Player ${seen.size + 1}`; seen.add(n); return n; };
const phone = () => "05" + Array.from({ length: 8 }, () => ri(10)).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ack = (s, e, d, t = 15000) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("ack " + e)), t); s.emit(e, d, (r) => { clearTimeout(to); res(r); }); });
const conn = () => new Promise((res, rej) => { const s = io(URL, { transports: ["websocket"], reconnection: false }); s.on("connect", () => res(s)); s.on("connect_error", rej); setTimeout(() => rej(new Error("conn")), 15000); });

// answer once a question starts: bias toward the correct answer by `skill`,
// using the local questions file (same order as the host's bank).
function wireAutoAnswer(sock, skill) {
  sock.on("game:questionStart", (data) => {
    const qi = data?.question?.index ?? 0;
    const tl = data?.question?.timeLimit || Q_TIME;
    const correct = QS[qi]?.correct || "A";
    const ans = Math.random() < skill ? correct : LETTERS.filter((l) => l !== correct)[ri(3)];
    const delay = 600 + Math.random() * (tl * 1000 * 0.6);
    setTimeout(() => { try { sock.emit("player:answer", { answer: ans }, () => {}); } catch {} }, delay);
  });
}

async function joinPlayers(sessionId) {
  let joined = 0, fail = 0, next = 0;
  const players = [];
  async function worker() {
    while (next < N) {
      const i = next++;
      try {
        const sock = await conn();
        const skill = 0.3 + Math.random() * 0.6; // 30–90% correct
        const r = await ack(sock, "player:join", { sessionId, name: uname(), phone: phone(), region: REGIONS[i % 3] });
        if (r?.success) { joined++; players.push(sock); wireAutoAnswer(sock, skill); }
        else { fail++; sock.close(); }
      } catch { fail++; }
      if (joined % 50 === 0 && joined) process.stdout.write(`  ${joined} joined…\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nJoined ${joined}/${N} (failed ${fail}).`);
  return players;
}

function printWinners(d) {
  const rr = d?.stats?.regionResults || [];
  console.log("\n=== FINAL WINNERS BY REGION ===");
  for (const r of rr) {
    console.log(`\n${r.label} (top ${r.winnerCount}):`);
    r.winners.slice(0, 5).forEach((w) => console.log(`  ${w.rank}. ${w.name} — ${w.score.toLocaleString()} [${w.phone}]`));
    if (r.winners.length > 5) console.log(`  …and ${r.winners.length - 5} more`);
  }
}

async function main() {
  // MODE 1 — join an EXISTING session (you drive the game from /host)
  if (process.env.SESSION) {
    const sessionId = process.env.SESSION;
    console.log(`\n=== Joining ${N} real-like players into session ${sessionId.slice(0, 8)}… on ${URL} ===\n`);
    const players = await joinPlayers(sessionId);
    let ended = false;
    players[0]?.on("game:end", (d) => { ended = true; printWinners(d); });
    console.log(`\n>>> Now open ${URL}/host and run the game (Start → Next …). The players will auto-answer.`);
    console.log(`>>> Watch ${URL}/display?s=${sessionId}\n`);
    // keep players connected until the game ends or 20 min pass
    for (let i = 0; i < 20 * 60 && !ended; i++) await sleep(1000);
    await sleep(1500);
    players.forEach((s) => { try { s.close(); } catch {} });
    console.log(`\nDone. Winners: ${URL}/winners\n`);
    process.exit(0);
  }

  // MODE 2 — self-contained: the script also hosts and drives the game
  const host = await conn();
  const c = await ack(host, "host:create", { questions: QS, defaultTimeLimit: Q_TIME });
  const { sessionId, hostKey } = c;
  console.log(`\n=== Simulating ${N} real-like players on ${URL} ===`);
  console.log(`SESSION: ${sessionId}`);
  console.log(`WATCH LIVE: ${URL}/display?s=${sessionId}\n`);
  host.on("game:end", printWinners);

  const players = await joinPlayers(sessionId);
  console.log("Starting game…\n");
  await ack(host, "host:start", { sessionId, hostKey });
  for (let qi = 0; qi < QS.length; qi++) {
    const hasCtx = !!(QS[qi].context && String(QS[qi].context).trim());
    await ack(host, "host:next", { sessionId, hostKey });
    console.log(`Q${qi + 1}/${QS.length} live…`);
    await sleep(3000 + (hasCtx ? 6500 : 1000) + Q_TIME * 1000 + 3000);
    await ack(host, "host:leaderboard", { sessionId, hostKey }).catch(() => {});
    await sleep(1500);
  }
  await ack(host, "host:end", { sessionId, hostKey }).catch(() => {});
  await sleep(1500);
  console.log(`\nDone. Winners page: ${URL}/winners\n`);
  players.forEach((s) => { try { s.close(); } catch {} });
  try { host.close(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error("SIM ERROR:", e.message); process.exit(1); });
