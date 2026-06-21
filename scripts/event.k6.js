// Full end-to-end k6 load test — each VU is a real player that REGISTERS
// (unique name/email/region), then ANSWERS every question the host pushes,
// until game:end. Speaks the Socket.IO (Engine.IO v4) protocol over WebSocket.
//
// Pair it with the host driver which creates the session and drives the game:
//   1) node scripts/event.host.mjs            # prints SESSION=<id>, waits for players
//   2) k6 run -e URL=https://aljeel-omq.up.railway.app -e SESSION=<id> -e VUS=500 \
//          scripts/event.k6.js
//   The host auto-starts the game once enough players have joined.
import ws from "k6/ws";
import { check } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

const joined = new Counter("evt_joined");
const joinFailed = new Counter("evt_join_failed");
const joinRate = new Rate("evt_join_success");
const joinLat = new Trend("evt_join_latency_ms", true);
const ansAccepted = new Counter("evt_answers_accepted");
const ansRejected = new Counter("evt_answers_rejected");
const ansRate = new Rate("evt_answer_success");
const ansLat = new Trend("evt_answer_latency_ms", true);
const gotQuestion = new Counter("evt_questions_received");
const gotEnd = new Counter("evt_reached_end");

const URL = __ENV.URL || "http://localhost:5050";
const SESSION = __ENV.SESSION || "";
const VUS = parseInt(__ENV.VUS || "500", 10);
const RAMP = __ENV.RAMP || "45s";    // how long to ramp all players in (registration)
const GAME = __ENV.GAME || "300s";   // hold connections through the whole game
const LETTERS = ["A", "B", "C", "D"];

export const options = {
  scenarios: {
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS }, // register players
        { duration: GAME, target: VUS }, // hold + answer through the game
        { duration: "5s", target: 0 },   // drain
      ],
      gracefulStop: "15s",
    },
  },
  thresholds: {
    evt_join_success: ["rate>0.98"],
    evt_answer_success: ["rate>0.95"],
  },
};

export default function () {
  if (!SESSION) throw new Error("Set SESSION=<sessionId> from the host driver");
  const wsUrl = URL.replace(/^http/, "ws") + "/socket.io/?EIO=4&transport=websocket";

  // Region mix: 50% Riyadh, 30% Jeddah, 20% Al Khobar (so each region has more
  // players than its winner cap → validates the 20/15/10 selection).
  const r = __VU / VUS;
  const region = r <= 0.5 ? "riyadh" : r <= 0.8 ? "jeddah" : "khobar";
  const uid = `${__VU}_${__ITER}`;
  const name = `K6Player${uid} Tester${uid}`;
  const email = `k6_${uid}@loadtest.example`;

  let ackId = 1;            // 1 reserved for join
  let joinSentAt = 0;
  const pending = {};       // ackId -> sentAt (for answers)

  const res = ws.connect(wsUrl, {}, function (socket) {
    socket.on("message", function (msg) {
      // Engine.IO OPEN "0{...}" → connect to default namespace
      if (msg.charAt(0) === "0" && msg.charAt(1) === "{") { socket.send("40"); return; }
      // Engine.IO PING "2" → PONG "3"
      if (msg === "2") { socket.send("3"); return; }
      // Namespace CONNECT "40{...}" → emit player:join (ack id 1)
      if (msg.indexOf("40") === 0 && msg.charAt(2) !== "0") {
        joinSentAt = Date.now();
        socket.send("421" + JSON.stringify(["player:join", { sessionId: SESSION, name, email, region }]));
        return;
      }
      // Join ACK "431[{success,...}]" (the "[" disambiguates ack id 1 from
      // ids 10/11 which also start with "431")
      if (msg.indexOf("431[") === 0) {
        joinLat.add(Date.now() - joinSentAt);
        let ok = false;
        try { const a = JSON.parse(msg.slice(3)); ok = a[0] && a[0].success === true; } catch (e) {}
        joinRate.add(ok);
        if (ok) joined.add(1); else joinFailed.add(1);
        return;
      }
      // EVENT "42[...]" (no ack id on broadcasts)
      if (msg.indexOf("42[") === 0) {
        let evt;
        try { evt = JSON.parse(msg.slice(2)); } catch (e) { return; }
        const name0 = evt[0];
        if (name0 === "game:questionStart") {
          gotQuestion.add(1);
          // answer after realistic think-time within the question window
          const id = ++ackId;
          const answer = LETTERS[Math.floor(Math.random() * 4)];
          const delay = 600 + Math.floor(Math.random() * 5000);
          socket.setTimeout(function () {
            pending[id] = Date.now();
            socket.send("42" + id + JSON.stringify(["player:answer", { answer }]));
          }, delay);
        } else if (name0 === "game:end") {
          gotEnd.add(1);
          // Do NOT close here — re-iterating would re-join the now-ended session
          // and fail. Park the connection; k6 closes it on ramp-down.
        }
        return;
      }
      // Answer ACK "43<id>[{success,...}]" (exclude only the join ack id 1)
      if (msg.indexOf("43") === 0 && msg.indexOf("431[") !== 0) {
        const m = msg.match(/^43(\d+)(\[.*)$/);
        if (m) {
          const id = parseInt(m[1], 10);
          if (pending[id]) { ansLat.add(Date.now() - pending[id]); delete pending[id]; }
          let ok = false;
          try { const a = JSON.parse(m[2]); ok = a[0] && a[0].success === true; } catch (e) {}
          ansRate.add(ok);
          if (ok) ansAccepted.add(1); else ansRejected.add(1);
        }
        return;
      }
    });

    // Safety cap: never hold a single socket longer than the whole game window.
    socket.setTimeout(function () { socket.close(); }, 20 * 60 * 1000);
  });

  check(res, { "ws handshake 101": (r) => r && r.status === 101 });
}
