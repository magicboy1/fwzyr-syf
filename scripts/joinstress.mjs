// Join stress test: hammers connect + player:join and reports how many succeed,
// how fast, and where it breaks. Holds connections open to simulate a full lobby.
//
// Usage:
//   node scripts/joinstress.mjs [players] [url]
//   PLAYERS=500 URL=https://your-app.up.railway.app node scripts/joinstress.mjs
//
// Knobs (env):
//   CONCURRENCY  how many joins in flight at once (default 40)
//   ACK_TIMEOUT  ms to wait for connect/join ack    (default 15000)
//   HOLD         seconds to keep sockets open after  (default 10)
//   SESSION      join this existing session id instead of creating a fresh one
//
// Note: all connections come from THIS machine's single IP. Proxies (e.g.
// Railway) often cap concurrent connections per IP (~400-450), so a single
// machine can't prove 500+ real players (who each use a different IP). For true
// scale, run this from several machines/regions at once and sum the numbers.
import { io } from "socket.io-client";

const N = parseInt(process.argv[2] || process.env.PLAYERS || "300", 10);
const URL = process.argv[3] || process.env.URL || "http://localhost:5000";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "40", 10);
const ACK_TIMEOUT = parseInt(process.env.ACK_TIMEOUT || "15000", 10);
const HOLD = parseInt(process.env.HOLD || "10", 10);

const ack = (sock, event, data, t = ACK_TIMEOUT) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("ack timeout: " + event)), t);
    sock.emit(event, data, (r) => { clearTimeout(to); resolve(r); });
  });
const connect = () =>
  new Promise((resolve, reject) => {
    const s = io(URL, { transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), ACK_TIMEOUT);
  });
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function getSessionId() {
  if (process.env.SESSION) return process.env.SESSION;
  const host = await connect();
  const c = await ack(host, "host:create", {
    questions: [{ id: "q1", text: "Q", options: ["a", "b", "c", "d"], correct: "A", timeLimit: 30 }],
    defaultTimeLimit: 30,
  });
  if (!c?.success) throw new Error("host:create failed");
  // keep host socket open so the LOBBY session stays alive during the test
  globalThis.__host = host;
  return c.sessionId;
}

async function main() {
  console.log(`\n=== Join stress: ${N} players, concurrency ${CONCURRENCY}, ${URL} ===\n`);
  const sessionId = await getSessionId();
  console.log(`Joining session ${sessionId.slice(0, 8)}…\n`);

  const sockets = [];
  const latencies = [];
  let joined = 0, connectFail = 0, joinFail = 0, next = 0;
  const t0 = Date.now();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= N) return;
      const start = Date.now();
      let sock;
      try {
        sock = await connect();
      } catch {
        connectFail++;
        continue;
      }
      try {
        const r = await ack(sock, "player:join", {
          sessionId, name: `Stress User ${i}`, email: `stress@example.com`, region: ["riyadh", "jeddah", "khobar"][i % 3],
        });
        if (r?.success) {
          joined++;
          latencies.push(Date.now() - start);
          sockets.push(sock);
        } else {
          joinFail++;
          sock.close();
        }
      } catch {
        joinFail++;
        try { sock.close(); } catch {}
      }
      if (joined && joined % 50 === 0) process.stdout.write(`  ${joined} joined…\r`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = Date.now() - t0;

  console.log(`\n--- Results ---`);
  console.log(`joined:        ${joined}/${N}`);
  console.log(`connect fails: ${connectFail}`);
  console.log(`join fails:    ${joinFail}`);
  console.log(`wall time:     ${(elapsed / 1000).toFixed(1)}s  (${(joined / (elapsed / 1000)).toFixed(0)} joins/sec)`);
  console.log(`join latency:  p50 ${pct(latencies, 50)}ms | p95 ${pct(latencies, 95)}ms | max ${Math.max(0, ...latencies)}ms`);
  console.log(`\nHolding ${joined} connections open for ${HOLD}s (simulating a full lobby)…`);
  await new Promise((r) => setTimeout(r, HOLD * 1000));

  sockets.forEach((s) => { try { s.close(); } catch {} });
  try { globalThis.__host?.close(); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  console.log("Done.\n");
  process.exit(0);
}

main().catch((e) => { console.error("STRESS ERROR:", e.message); process.exit(1); });
