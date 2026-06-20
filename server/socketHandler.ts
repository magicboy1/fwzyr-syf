import { Server as SocketServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import {
  createSession,
  getSession,
  addPlayer,
  reconnectPlayer,
  disconnectPlayer,
  kickPlayer,
  startGame,
  nextQuestion,
  startQuestionTimer,
  getQuestionForPlayer,
  getBigScreenQuestion,
  submitAnswer,
  endQuestion,
  getReveal,
  showLeaderboard,
  endGame,
  pauseGame,
  resumeGame,
  restartGame,
  getPlayerCount,
  getPlayerList,
  getLeaderboard,
} from "./gameEngine";
import type { Question } from "@shared/schema";
import { log } from "./index";

const timers = new Map<string, NodeJS.Timeout>();
const contextTimers = new Map<string, NodeJS.Timeout>();
const revealTimers = new Map<string, NodeJS.Timeout>();
const answerUpdateTimers = new Map<string, NodeJS.Timeout>();
const CONTEXT_DURATION = 6000;
// Coalesce answerUpdate broadcasts: at high player counts, emitting on every
// single answer floods the event loop. We flush at most once per this window.
const ANSWER_UPDATE_THROTTLE_MS = 400;

function clearSessionTimers(sessionId: string) {
  const t = timers.get(sessionId);
  if (t) { clearTimeout(t); timers.delete(sessionId); }
  const ct = contextTimers.get(sessionId);
  if (ct) { clearTimeout(ct); contextTimers.delete(sessionId); }
  const rt = revealTimers.get(sessionId);
  if (rt) { clearTimeout(rt); revealTimers.delete(sessionId); }
  const at = answerUpdateTimers.get(sessionId);
  if (at) { clearTimeout(at); answerUpdateTimers.delete(sessionId); }
}

let ioRef: SocketServer | null = null;

// End a session from the admin side (no host key needed; the admin route is
// already authenticated). Ends the game and broadcasts the final stats.
export function forceEndSession(sessionId: string): boolean {
  if (!ioRef) return false;
  const session = getSession(sessionId);
  if (!session) return false;
  clearSessionTimers(sessionId);
  const stats = endGame(sessionId);
  ioRef.to(`session:${sessionId}`).emit("game:end", { stats });
  return true;
}

export function setupSocketIO(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
    transports: ["websocket"],
    allowUpgrades: false,
    pingInterval: 25000,
    // Forgiving timeout: under a CPU spike the event loop can stall briefly.
    // A short pingTimeout makes hundreds of clients falsely disconnect and
    // reconnect at once (a "reconnection avalanche"), which deepens the spike.
    pingTimeout: 40000,
    maxHttpBufferSize: 1e5,
    perMessageDeflate: false,
    httpCompression: false,
    connectTimeout: 10000,
  });
  ioRef = io;

  // Coalesced answer-progress broadcast. Many answers arriving within the same
  // window produce a single emit to host + display instead of one per answer.
  function scheduleAnswerUpdate(sessionId: string) {
    if (answerUpdateTimers.has(sessionId)) return;
    const t = setTimeout(() => {
      answerUpdateTimers.delete(sessionId);
      try {
        const session = getSession(sessionId);
        if (!session) return;
        const qi = session.currentQuestionIndex;
        let answeredCount = 0;
        for (const pid of Object.keys(session.players)) {
          if (session.answersIndex.has(`${pid}:${qi}`)) answeredCount++;
        }
        const updateData = { answeredCount, totalPlayers: Object.keys(session.players).length };
        io.to(`host:${sessionId}`).emit("game:answerUpdate", updateData);
        io.to(`display:${sessionId}`).emit("game:answerUpdate", updateData);
      } catch (e) {
        console.error("Error in answerUpdate flush:", e);
      }
    }, ANSWER_UPDATE_THROTTLE_MS);
    answerUpdateTimers.set(sessionId, t);
  }

  function emitNextQuestion(sessionId: string) {
    const oldCtxTimer = contextTimers.get(sessionId);
    if (oldCtxTimer) { clearTimeout(oldCtxTimer); contextTimers.delete(sessionId); }

    const session = getSession(sessionId);
    if (!session) return;
    const nextIdx = session.currentQuestionIndex + 1;
    const hasContext = nextIdx < session.questions.length && !!(session.questions[nextIdx].context?.trim());

    const question = nextQuestion(sessionId, hasContext);
    if (!question) {
      const stats = endGame(sessionId);
      io.to(`session:${sessionId}`).emit("game:end", { stats });
      return;
    }

    if (hasContext) {
      io.to(`display:${sessionId}`).emit("game:context", {
        context: question.context,
        category: question.category,
        index: question.index,
        totalQuestions: question.totalQuestions,
        duration: CONTEXT_DURATION,
      });

      io.to(`host:${sessionId}`).emit("game:context", {
        context: question.context,
        index: question.index,
        duration: CONTEXT_DURATION,
      });

      const ctxTimeout = setTimeout(() => {
        contextTimers.delete(sessionId);
        const s = getSession(sessionId);
        if (!s || s.phase !== "CONTEXT") return;
        startQuestionTimer(sessionId);
        emitQuestionToAll(sessionId, question);
      }, CONTEXT_DURATION);
      contextTimers.set(sessionId, ctxTimeout);
    } else {
      emitQuestionToAll(sessionId, question);
    }
  }

  function emitQuestionToAll(sessionId: string, question: NonNullable<ReturnType<typeof nextQuestion>>) {
    const session = getSession(sessionId);
    if (!session) return;
    const playerQuestion = getQuestionForPlayer(sessionId);

    io.to(`display:${sessionId}`).emit("game:questionStart", {
      question,
      serverTime: Date.now(),
      totalPlayers: getPlayerCount(sessionId),
    });
    io.to(`host:${sessionId}`).emit("game:questionStart", {
      question: { ...question, options: session.questions[session.currentQuestionIndex].options, correct: session.questions[session.currentQuestionIndex].correct },
      serverTime: Date.now(),
      answeredCount: 0,
      totalPlayers: getPlayerCount(sessionId),
    });

    io.to(`session:${sessionId}`).except(`display:${sessionId}`).except(`host:${sessionId}`).emit("game:questionStart", {
      question: playerQuestion,
      serverTime: Date.now(),
    });

    scheduleQuestionEnd(sessionId, (question.timeLimit + 1) * 1000);
  }

  // After `ms`, end the question, emit questionEnd, then auto-reveal 1.5s later.
  // Used both by the normal question timer and by host:resume so the auto-reveal
  // fires either way. The reveal timeout is tracked so it can be cancelled if the
  // host advances manually (otherwise a stale reveal could land over the next q).
  function scheduleQuestionEnd(sessionId: string, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      try {
        endQuestion(sessionId);
        io.to(`session:${sessionId}`).emit("game:questionEnd");

        const rt = setTimeout(() => {
          revealTimers.delete(sessionId);
          try {
            const sess = getSession(sessionId);
            const reveal = getReveal(sessionId);
            if (reveal && sess) {
              const isLastQuestion = sess.currentQuestionIndex >= sess.questions.length - 1;
              io.to(`session:${sessionId}`).emit("game:reveal", { reveal, isLastQuestion });
            }
          } catch (e) {
            console.error("Error in reveal timeout:", e);
          }
        }, 1500);
        revealTimers.set(sessionId, rt);
      } catch (e) {
        console.error("Error in question end timeout:", e);
      }
    }, ms);
    timers.set(sessionId, timer);
  }

  io.engine.on("connection_error", (err: any) => {
    console.error("Engine connection error:", err.code, err.message);
  });

  io.on("connection", (socket: Socket) => {
    let currentSessionId: string | null = null;
    let currentPlayerId: string | null = null;
    let isHost = false;

    socket.on("error", (err) => {
      console.error("Socket error:", err.message);
    });

    socket.on("host:create", (data: { questions: Question[]; defaultTimeLimit?: number }, callback) => {
      try {
        const session = createSession(data.questions, data.defaultTimeLimit || 30);
        currentSessionId = session.id;
        isHost = true;
        socket.join(`session:${session.id}`);
        socket.join(`host:${session.id}`);
        callback?.({
          success: true,
          sessionId: session.id,
          hostKey: session.hostKey,
        });
        log(`Session created: ${session.id}`, "socket");
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:reconnect", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Invalid session" });
          return;
        }
        currentSessionId = session.id;
        isHost = true;
        socket.join(`session:${session.id}`);
        socket.join(`host:${session.id}`);
        callback?.({
          success: true,
          session: {
            id: session.id,
            phase: session.phase,
            currentQuestionIndex: session.currentQuestionIndex,
            totalQuestions: session.questions.length,
            paused: session.paused,
            playerCount: getPlayerCount(session.id),
            players: getPlayerList(session.id),
          },
        });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("display:join", (data: { sessionId: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session) {
          callback?.({ success: false, error: "Session not found" });
          return;
        }
        currentSessionId = session.id;
        socket.join(`session:${session.id}`);
        socket.join(`display:${session.id}`);
        const res: any = {
          success: true,
          sessionId: session.id,
          phase: session.phase,
          playerCount: getPlayerCount(session.id),
          players: getPlayerList(session.id),
        };
        // Hydrate a display that opens/refreshes mid-game so it isn't blank.
        if (session.phase === "QUESTION") {
          res.question = getBigScreenQuestion(session.id);
          const rem = session.timerStartedAt && session.timerDuration
            ? session.timerDuration * 1000 - (Date.now() - session.timerStartedAt)
            : 0;
          res.timeLeft = Math.max(0, rem / 1000);
        } else if (session.phase === "REVEAL" && session.lastReveal) {
          res.reveal = session.lastReveal;
          res.question = getBigScreenQuestion(session.id);
        } else if (session.phase === "LEADERBOARD" && session.lastLeaderboard) {
          res.leaderboard = session.lastLeaderboard;
        } else if (session.phase === "END" && session.lastStats) {
          res.stats = session.lastStats;
        }
        callback?.(res);
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("player:join", (data: { sessionId: string; name: string; email?: string; region?: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session) {
          callback?.({ success: false, error: "Game not found." });
          return;
        }
        if (session.phase !== "LOBBY") {
          callback?.({ success: false, error: "The game has already started." });
          return;
        }

        const result = addPlayer(session.id, data.name, data.email || "", data.region || "");
        if (!result.ok) {
          const error = result.reason === "email"
            ? "This email is already registered."
            : result.reason === "name"
            ? "That name is taken. Try a different one."
            : "Could not join.";
          callback?.({ success: false, error });
          return;
        }
        const player = result.player;

        currentSessionId = session.id;
        currentPlayerId = player.id;
        socket.join(`session:${session.id}`);
        socket.join(`player:${player.id}`);

        const playerCount = getPlayerCount(session.id);
        // Send only the new player (not the whole list) so a join rush of N
        // players stays O(N) instead of O(N²) in serialized payload.
        const joinPayload = {
          player: { id: player.id, name: player.name, region: player.region },
          playerCount,
        };
        io.to(`display:${session.id}`).emit("game:playerJoined", joinPayload);
        io.to(`host:${session.id}`).emit("game:playerJoined", joinPayload);

        callback?.({
          success: true,
          playerId: player.id,
          sessionId: session.id,
          playerName: player.name,
        });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("player:reconnect", (data: { sessionId: string; playerId: string }, callback) => {
      try {
        const player = reconnectPlayer(data.sessionId, data.playerId);
        if (!player) {
          callback?.({ success: false, error: "Could not reconnect" });
          return;
        }

        currentSessionId = data.sessionId;
        currentPlayerId = data.playerId;
        socket.join(`session:${data.sessionId}`);
        socket.join(`player:${data.playerId}`);

        const session = getSession(data.sessionId);
        const response: any = {
          success: true,
          playerId: player.id,
          playerName: player.name,
          phase: session?.phase,
          score: player.score,
        };

        if (session && session.phase === "QUESTION") {
          response.question = getQuestionForPlayer(data.sessionId);
          response.serverTime = Date.now();
          response.timerStartedAt = session.timerStartedAt;
          response.timerDuration = session.timerDuration;
          const rem = session.timerStartedAt && session.timerDuration
            ? session.timerDuration * 1000 - (Date.now() - session.timerStartedAt)
            : 0;
          response.timeLeft = Math.max(0, rem / 1000);
          response.alreadyAnswered = session.answersIndex.has(`${data.playerId}:${session.currentQuestionIndex}`);
        }

        callback?.(response);
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:start", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }
        if (!startGame(data.sessionId)) {
          callback?.({ success: false, error: "Cannot start the game" });
          return;
        }
        callback?.({ success: true });
        log(`Game started: ${session.id}`, "socket");
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:next", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        clearSessionTimers(data.sessionId);

        const isDoublePoints = session.currentQuestionIndex + 1 === session.doublePointsIndex;
        if (isDoublePoints) {
          io.to(`session:${data.sessionId}`).emit("game:doublePoints");
          setTimeout(() => {
            try { emitNextQuestion(data.sessionId); } catch (e) { console.error("Error in double points next:", e); }
          }, 3000);
        } else {
          emitNextQuestion(data.sessionId);
        }
        callback?.({ success: true });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("player:answer", (data: { sessionId?: string; playerId?: string; answer: "A" | "B" | "C" | "D" }, callback) => {
      try {
        // Trust the socket's own identity, not client-supplied ids — otherwise
        // a client could submit answers on behalf of any other player.
        if (!currentSessionId || !currentPlayerId) {
          callback?.({ success: false, error: "Could not record answer" });
          return;
        }

        const feedback = submitAnswer(currentSessionId, currentPlayerId, data.answer);
        if (!feedback) {
          callback?.({ success: false, error: "Could not record answer" });
          return;
        }

        callback?.({ success: true, feedback });

        scheduleAnswerUpdate(currentSessionId);
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:reveal", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        clearSessionTimers(data.sessionId);

        endQuestion(data.sessionId);
        const reveal = getReveal(data.sessionId);
        if (!reveal) {
          callback?.({ success: false, error: "No question to reveal" });
          return;
        }

        const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
        io.to(`session:${data.sessionId}`).emit("game:reveal", { reveal, isLastQuestion });
        callback?.({ success: true, isLastQuestion });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:leaderboard", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        const leaderboard = showLeaderboard(data.sessionId);
        const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
        io.to(`session:${data.sessionId}`).emit("game:leaderboard", { leaderboard, isLastQuestion });
        callback?.({ success: true, isLastQuestion });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:end", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        clearSessionTimers(data.sessionId);

        const stats = endGame(data.sessionId);
        io.to(`session:${data.sessionId}`).emit("game:end", { stats });
        callback?.({ success: true });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:pause", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        if (pauseGame(data.sessionId)) {
          const oldTimer = timers.get(data.sessionId);
          if (oldTimer) { clearTimeout(oldTimer); timers.delete(data.sessionId); }
          io.to(`session:${data.sessionId}`).emit("game:paused");
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "Cannot pause" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:resume", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        if (resumeGame(data.sessionId)) {
          const remaining = session.timerStartedAt && session.timerDuration
            ? session.timerDuration * 1000 - (Date.now() - session.timerStartedAt)
            : 0;
          io.to(`session:${data.sessionId}`).emit("game:resumed", {
            serverTime: Date.now(),
            timerStartedAt: session.timerStartedAt,
            timerDuration: session.timerDuration,
            timeLeft: Math.max(0, remaining / 1000),
          });

          if (remaining > 0) {
            // Reuse the normal end+auto-reveal chain so resume reveals too.
            scheduleQuestionEnd(data.sessionId, remaining);
          }
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "Cannot resume" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:kick", (data: { sessionId: string; hostKey: string; playerId: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        if (kickPlayer(data.sessionId, data.playerId)) {
          io.to(`player:${data.playerId}`).emit("game:kicked");
          io.to(`session:${data.sessionId}`).emit("game:playerLeft", {
            playerId: data.playerId,
            playerCount: getPlayerCount(data.sessionId),
            players: getPlayerList(data.sessionId),
          });
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "Player not found" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:restart", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "Unauthorized" });
          return;
        }

        clearSessionTimers(data.sessionId);

        if (restartGame(data.sessionId)) {
          io.to(`session:${data.sessionId}`).emit("game:restarted");

          const room = io.sockets.adapter.rooms.get(`session:${data.sessionId}`);
          if (room) {
            for (const socketId of Array.from(room)) {
              const s = io.sockets.sockets.get(socketId);
              if (s) s.leave(`session:${data.sessionId}`);
            }
          }

          io.to(`display:${data.sessionId}`).emit("game:restarted");
          io.to(`host:${data.sessionId}`).emit("game:hostRestarted", {
            playerCount: 0,
            players: [],
          });
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "Cannot restart" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("time:sync", (callback) => {
      try {
        callback?.({ serverTime: Date.now() });
      } catch (_) {}
    });

    socket.on("disconnect", () => {
      try {
        if (currentSessionId && currentPlayerId) {
          disconnectPlayer(currentSessionId, currentPlayerId);
        }
      } catch (_) {}
    });
  });

  return io;
}
