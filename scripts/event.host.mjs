// Host driver for the full end-to-end k6 event test. Creates the session,
// waits for the k6 players to register, then drives start → each question
// (reveal once ~everyone answered) → end, and prints the winners by region.
//
// Usage:
//   node scripts/event.host.mjs            # uses prod by default; prints SESSION=<id>
//   TARGET=500 Q_TIME=12 URL=https://aljeel-omq.up.railway.app node scripts/event.host.mjs
import { io } from "socket.io-client";
import { readFileSync } from "fs";

const URL = process.env.URL || "https://aljeel-omq.up.railway.app";
const TARGET = parseInt(process.env.TARGET || "500", 10);
const Q_TIME = parseInt(process.env.Q_TIME || "12", 10);
const START_FRAC = parseFloat(process.env.START_FRAC || "0.9");
const MAX_JOIN_WAIT = parseInt(process.env.MAX_JOIN_WAIT || "150", 10) * 1000;
const ANS_FRAC = parseFloat(process.env.ANS_FRAC || "0.95");
const Q_MAX_WAIT = parseInt(process.env.Q_MAX_WAIT || "20", 10) * 1000;

const QS = JSON.parse(readFileSync("data/questions.json", "utf-8")).map((q) => ({ ...q, timeLimit: Q_TIME }));
const ack = (s, e, d, t = 20000) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("ack " + e)), t); s.emit(e, d, (r) => { clearTimeout(to); res(r); }); });
const conn = () => new Promise((res, rej) => { const s = io(URL, { transports: ["websocket"], reconnection: false }); s.on("connect", () => res(s)); s.on("connect_error", rej); setTimeout(() => rej(new Error("conn")), 20000); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const host = await conn();
const { sessionId, hostKey } = await ack(host, "host:create", { questions: QS, defaultTimeLimit: Q_TIME });
console.log("SESSION=" + sessionId);
console.log("HOSTKEY=" + hostKey);
console.log("WATCH=" + URL + "/display?s=" + sessionId);
console.log(`Waiting for players (target ${TARGET}, start at ${Math.round(TARGET * START_FRAC)})…`);

let playerCount = 0, answeredCount = 0, firstJoin = 0, finalStats = null;
host.on("game:playerJoined", (d) => { playerCount = d.playerCount ?? playerCount + 1; if (!firstJoin) firstJoin = now(); });
host.on("game:playerLeft", (d) => { if (typeof d.playerCount === "number") playerCount = d.playerCount; });
host.on("game:answerUpdate", (d) => { answeredCount = d.answeredCount; if (typeof d.totalPlayers === "number") playerCount = d.totalPlayers; });
host.on("game:end", (d) => { finalStats = d.stats; });

// 1) wait for players to register
const waitStart = now();
while (true) {
  await sleep(1000);
  const enough = playerCount >= TARGET * START_FRAC;
  const timedOut = firstJoin && now() - firstJoin > MAX_JOIN_WAIT;
  process.stdout.write(`  joined ${playerCount}/${TARGET}\r`);
  if (enough || timedOut) break;
  if (now() - waitStart > 10 * 60 * 1000) break; // absolute safety
}
console.log(`\nStarting game with ${playerCount} players.`);

// 2) drive the game
await ack(host, "host:start", { sessionId, hostKey });
for (let q = 0; q < QS.length; q++) {
  answeredCount = 0;
  await ack(host, "host:next", { sessionId, hostKey });
  const qStart = now();
  // wait until ~everyone answered, or the per-question cap (covers the 6s value
  // intro + the players' think-time)
  while (now() - qStart < Q_MAX_WAIT + 7000) {
    await sleep(300);
    if (playerCount > 0 && answeredCount >= playerCount * ANS_FRAC) break;
  }
  await ack(host, "host:reveal", { sessionId, hostKey }).catch(() => {});
  await sleep(800);
  await ack(host, "host:leaderboard", { sessionId, hostKey }).catch(() => {});
  await sleep(800);
  console.log(`Q${q + 1}/${QS.length}: answered ${answeredCount}/${playerCount}`);
}
await ack(host, "host:end", { sessionId, hostKey }).catch(() => {});
await sleep(1500);

// 3) report
console.log("\n=== FINAL RESULT ===");
if (finalStats) {
  console.log(`Total players: ${finalStats.totalPlayers} | participation: ${Math.round(finalStats.participationRate)}% | avg response: ${Math.round(finalStats.avgResponseTime)}ms`);
  for (const r of finalStats.regionResults || []) {
    console.log(`  ${r.label}: ${r.winners.length}/${r.winnerCount} winners (top: ${(r.winners[0]?.name || "-")} = ${r.winners[0]?.score ?? "-"})`);
  }
}
console.log("SESSION_TO_CLEANUP=" + sessionId);
console.log("HOSTKEY=" + hostKey);
process.exit(0);
