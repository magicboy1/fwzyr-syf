// Load test: simulates a host + N players joining, answering questions
// concurrently, and measures success/latency/server memory.
//
// Usage:
//   node scripts/loadtest.mjs [players] [url]
//   PLAYERS=500 URL=http://localhost:5052 node scripts/loadtest.mjs
//
// Boot a production build first:  ADMIN_PASSWORD=x PORT=5052 node dist/index.cjs
import { io } from "socket.io-client";

const URL = process.argv[3] || process.env.URL || "http://localhost:5052";
const N = parseInt(process.argv[2] || process.env.PLAYERS || "300", 10);
const QUESTIONS_COUNT = 5;
const BATCH = parseInt(process.env.BATCH || "50", 10); // connect this many sockets at a time
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY || "150", 10);
const ACK_TIMEOUT = parseInt(process.env.ACK_TIMEOUT || "10000", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ack = (sock, event, data, timeout = ACK_TIMEOUT) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), timeout);
    sock.emit(event, data, (res) => { clearTimeout(t); resolve(res); });
  });

function makeQuestions(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `Question ${i + 1}?`,
    options: ["A opt", "B opt", "C opt", "D opt"],
    correct: "A",
    timeLimit: 20,
  }));
}

async function mem(label) {
  try {
    const res = await fetch(`${URL}/api/health`);
    const j = await res.json();
    console.log(`  [mem ${label}] rss=${j.memory.rss}MB heap=${j.memory.heap}MB`);
  } catch { /* ignore */ }
}

async function main() {
  console.log(`\n=== Load test: ${N} players against ${URL} ===\n`);
  await mem("start");

  // 1) Host creates session
  const host = io(URL, { transports: ["websocket"], reconnection: false });
  await new Promise((res, rej) => {
    host.on("connect", res);
    host.on("connect_error", rej);
    setTimeout(() => rej(new Error("host connect timeout")), 10000);
  });
  const created = await ack(host, "host:create", {
    questions: makeQuestions(QUESTIONS_COUNT),
    defaultTimeLimit: 20,
  });
  if (!created?.success) throw new Error("host:create failed");
  const { sessionId, hostKey } = created;
  console.log(`Host created session ${sessionId.slice(0, 8)}…\n`);

  // Track host's view of answeredCount per question
  let hostAnswered = 0;
  host.on("game:answerUpdate", (d) => { hostAnswered = d.answeredCount; });

  // 2) Connect + join players in batches
  const players = [];
  let joinFail = 0;
  const joinStart = Date.now();
  for (let i = 0; i < N; i += BATCH) {
    const slice = [];
    for (let k = i; k < Math.min(i + BATCH, N); k++) {
      slice.push((async () => {
        const sock = io(URL, { transports: ["websocket"], reconnection: false });
        try {
          await new Promise((res, rej) => {
            sock.on("connect", res);
            sock.on("connect_error", rej);
            setTimeout(() => rej(new Error("timeout")), ACK_TIMEOUT);
          });
          const r = await ack(sock, "player:join", {
            sessionId, name: `Player_${k}`, email: "",
          });
          if (!r?.success) { joinFail++; sock.close(); return; }
          const p = { sock, id: r.playerId, gotQuestion: false };
          sock.on("game:questionStart", () => { p.gotQuestion = true; });
          players.push(p);
        } catch { joinFail++; try { sock.close(); } catch {} }
      })());
    }
    await Promise.all(slice);
    await sleep(BATCH_DELAY_MS);
  }
  console.log(`Joined ${players.length}/${N} players in ${Date.now() - joinStart}ms (failed: ${joinFail})`);
  await mem("after join");

  // 3) Start game
  await ack(host, "host:start", { sessionId, hostKey });

  // 4) For each question: push it, wait for delivery, all players answer at once
  for (let q = 0; q < QUESTIONS_COUNT; q++) {
    players.forEach((p) => (p.gotQuestion = false));
    hostAnswered = 0;
    await ack(host, "host:next", { sessionId, hostKey });

    // wait until players actually receive the question (handles context/doublePoints delays)
    const waitStart = Date.now();
    while (Date.now() - waitStart < 12000) {
      const got = players.filter((p) => p.gotQuestion).length;
      if (got >= players.length * 0.99) break;
      await sleep(100);
    }
    const delivered = players.filter((p) => p.gotQuestion).length;

    // all players answer simultaneously
    let accepted = 0, rejected = 0, maxLatency = 0;
    const ansStart = Date.now();
    await Promise.all(players.map(async (p) => {
      const t0 = Date.now();
      try {
        const choice = ["A", "B", "C", "D"][Math.floor((p.id.charCodeAt(0) + q) % 4)];
        const r = await ack(p.sock, "player:answer", { answer: choice }, 8000);
        const lat = Date.now() - t0;
        if (lat > maxLatency) maxLatency = lat;
        if (r?.success) accepted++; else rejected++;
      } catch { rejected++; }
    }));
    const ansMs = Date.now() - ansStart;

    // give the throttled answerUpdate time to flush to host
    await sleep(600);
    console.log(
      `Q${q + 1}: delivered ${delivered}/${players.length} | answers accepted ${accepted} rejected ${rejected} ` +
      `| all-answers ${ansMs}ms maxAckLat ${maxLatency}ms | host saw ${hostAnswered}`
    );

    await ack(host, "host:reveal", { sessionId, hostKey });
    await sleep(200);
  }

  await mem("end");
  console.log("\n=== Done ===\n");

  host.close();
  players.forEach((p) => { try { p.sock.close(); } catch {} });
  await sleep(300);
  process.exit(0);
}

main().catch((e) => { console.error("LOAD TEST ERROR:", e); process.exit(1); });
