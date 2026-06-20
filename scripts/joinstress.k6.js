// k6 join stress test — speaks the Socket.IO (Engine.IO v4) protocol over
// WebSocket so it can drive this app's `player:join`. Each VU opens one
// connection, joins the lobby once, and holds it open for the whole run.
//
// Run k6 in the CLOUD to get many real source IPs (the only way to truly test
// 500+, since a single machine's IP gets throttled by the edge proxy).
//
// ── Setup ──────────────────────────────────────────────────────────────────
// 1) Install k6:                 brew install k6
// 2) In the app: open /host, log in, Create Session, open the display.
//    The display URL is /display?s=<SESSION_ID> — copy that id.
//    Leave the game in the LOBBY (do NOT press Start) during the test.
//
// ── Local run (limited to ~400 by your single IP) ──────────────────────────
//   k6 run -e URL=https://aljeel-omq.up.railway.app -e SESSION=<id> -e VUS=400 \
//       scripts/joinstress.k6.js
//
// ── Distributed run from many regions/IPs (the real test) ──────────────────
//   k6 cloud login --token <grafana-cloud-k6-token>
//   k6 cloud -e URL=https://aljeel-omq.up.railway.app -e SESSION=<id> -e VUS=800 \
//       scripts/joinstress.k6.js
//
// Env knobs: VUS (target concurrent players), RAMP (e.g. "60s"),
//            SUSTAIN (e.g. "60s"), URL, SESSION.
import ws from "k6/ws";
import { check } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

const joined = new Counter("sio_joined");
const joinFailed = new Counter("sio_join_failed");
const joinLatency = new Trend("sio_join_latency_ms", true);
const joinRate = new Rate("sio_join_success");

const URL = __ENV.URL || "http://localhost:5099";
const SESSION = __ENV.SESSION || "";
const VUS = parseInt(__ENV.VUS || "400", 10);
const RAMP = __ENV.RAMP || "60s";
const SUSTAIN = __ENV.SUSTAIN || "60s";

export const options = {
  scenarios: {
    join: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },   // ramp players in
        { duration: SUSTAIN, target: VUS }, // hold a full lobby
        { duration: "10s", target: 0 },     // drain
      ],
      gracefulStop: "10s",
    },
  },
  thresholds: {
    sio_join_success: ["rate>0.98"], // >98% of attempted joins succeed
  },
};

const REGIONS = ["riyadh", "jeddah", "khobar"];

export default function () {
  if (!SESSION) throw new Error("Set SESSION=<sessionId> (from the /display?s=... URL)");
  const wsUrl = URL.replace(/^http/, "ws") + "/socket.io/?EIO=4&transport=websocket";
  const name = `k6 user ${__VU}`;
  const region = REGIONS[__VU % 3];
  let joinSentAt = 0;

  const res = ws.connect(wsUrl, {}, function (socket) {
    socket.on("message", function (msg) {
      // Engine.IO OPEN packet "0{...}" → connect to the default namespace
      if (msg.charAt(0) === "0" && msg.charAt(1) === "{") {
        socket.send("40");
        return;
      }
      // Engine.IO PING "2" → PONG "3" (keeps the connection alive while held)
      if (msg === "2") {
        socket.send("3");
        return;
      }
      // Socket.IO namespace CONNECT "40{...}" → emit player:join with ack id 1
      if (msg.indexOf("40") === 0) {
        const payload = JSON.stringify([
          "player:join",
          { sessionId: SESSION, name, email: `k6-@example.com`, region },
        ]);
        joinSentAt = Date.now();
        socket.send("421" + payload); // 4=message, 2=EVENT, 1=ack id
        return;
      }
      // ACK for our join "431[{success:...}]"
      if (msg.indexOf("431") === 0) {
        joinLatency.add(Date.now() - joinSentAt);
        let ok = false;
        try { ok = JSON.parse(msg.slice(3))[0] && JSON.parse(msg.slice(3))[0].success === true; } catch (e) {}
        joinRate.add(ok);
        if (ok) joined.add(1); else joinFailed.add(1);
        return;
      }
    });

    // Hold the socket open for the whole test; k6 closes it on ramp-down.
    socket.setTimeout(function () { socket.close(); }, 60 * 60 * 1000);
  });

  check(res, { "ws handshake 101": (r) => r && r.status === 101 });
}
