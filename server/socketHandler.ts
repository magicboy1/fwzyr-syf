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
const CONTEXT_DURATION = 6000;

function clearSessionTimers(sessionId: string) {
  const t = timers.get(sessionId);
  if (t) { clearTimeout(t); timers.delete(sessionId); }
  const ct = contextTimers.get(sessionId);
  if (ct) { clearTimeout(ct); contextTimers.delete(sessionId); }
}

export function setupSocketIO(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
    transports: ["websocket"],
    allowUpgrades: false,
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5,
    perMessageDeflate: false,
    httpCompression: false,
    connectTimeout: 10000,
  });

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

    const timer = setTimeout(() => {
      timers.delete(sessionId);
      try {
        endQuestion(sessionId);
        io.to(`session:${sessionId}`).emit("game:questionEnd");

        setTimeout(() => {
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
      } catch (e) {
        console.error("Error in question end timeout:", e);
      }
    }, (question.timeLimit + 1) * 1000);
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
          callback?.({ success: false, error: "جلسة غير صالحة" });
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
          callback?.({ success: false, error: "الجلسة غير موجودة" });
          return;
        }
        currentSessionId = session.id;
        socket.join(`session:${session.id}`);
        socket.join(`display:${session.id}`);
        callback?.({
          success: true,
          sessionId: session.id,
          phase: session.phase,
          playerCount: getPlayerCount(session.id),
          players: getPlayerList(session.id),
        });
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("player:join", (data: { sessionId: string; name: string; phone: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session) {
          callback?.({ success: false, error: "اللعبة غير موجودة." });
          return;
        }
        if (session.phase !== "LOBBY") {
          callback?.({ success: false, error: "اللعبة بدأت بالفعل." });
          return;
        }

        const player = addPlayer(session.id, data.name, data.phone || "");
        if (!player) {
          callback?.({ success: false, error: "تعذر الانضمام. جرب اسم مختلف." });
          return;
        }

        currentSessionId = session.id;
        currentPlayerId = player.id;
        socket.join(`session:${session.id}`);
        socket.join(`player:${player.id}`);

        const playerCount = getPlayerCount(session.id);
        io.to(`display:${session.id}`).emit("game:playerJoined", {
          player: { id: player.id, name: player.name },
          playerCount,
        });
        io.to(`host:${session.id}`).emit("game:playerJoined", {
          player: { id: player.id, name: player.name },
          playerCount,
          players: getPlayerList(session.id),
        });

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
          callback?.({ success: false, error: "تعذر إعادة الاتصال" });
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
          callback?.({ success: false, error: "غير مصرح" });
          return;
        }
        if (!startGame(data.sessionId)) {
          callback?.({ success: false, error: "لا يمكن بدء اللعبة" });
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
          callback?.({ success: false, error: "غير مصرح" });
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

    socket.on("player:answer", (data: { sessionId: string; playerId: string; answer: "A" | "B" | "C" | "D" }, callback) => {
      try {
        const feedback = submitAnswer(data.sessionId, data.playerId, data.answer);
        if (!feedback) {
          callback?.({ success: false, error: "تعذر تسجيل الإجابة" });
          return;
        }

        callback?.({ success: true, feedback });

        const session = getSession(data.sessionId);
        if (session) {
          let answeredCount = 0;
          const qi = session.currentQuestionIndex;
          const playerIds = Object.keys(session.players);
          for (const pid of playerIds) {
            if (session.answersIndex.has(`${pid}:${qi}`)) answeredCount++;
          }
          const updateData = {
            answeredCount,
            totalPlayers: getPlayerCount(data.sessionId),
          };
          io.to(`host:${data.sessionId}`).emit("game:answerUpdate", updateData);
          io.to(`display:${data.sessionId}`).emit("game:answerUpdate", updateData);
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:reveal", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "غير مصرح" });
          return;
        }

        clearSessionTimers(data.sessionId);

        endQuestion(data.sessionId);
        const reveal = getReveal(data.sessionId);
        if (!reveal) {
          callback?.({ success: false, error: "لا يوجد سؤال للكشف" });
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
          callback?.({ success: false, error: "غير مصرح" });
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
          callback?.({ success: false, error: "غير مصرح" });
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
          callback?.({ success: false, error: "غير مصرح" });
          return;
        }

        if (pauseGame(data.sessionId)) {
          const oldTimer = timers.get(data.sessionId);
          if (oldTimer) { clearTimeout(oldTimer); timers.delete(data.sessionId); }
          io.to(`session:${data.sessionId}`).emit("game:paused");
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "لا يمكن الإيقاف" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:resume", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "غير مصرح" });
          return;
        }

        if (resumeGame(data.sessionId)) {
          io.to(`session:${data.sessionId}`).emit("game:resumed", {
            serverTime: Date.now(),
            timerStartedAt: session.timerStartedAt,
            timerDuration: session.timerDuration,
          });

          if (session.timerStartedAt && session.timerDuration) {
            const elapsed = Date.now() - session.timerStartedAt;
            const remaining = session.timerDuration * 1000 - elapsed;
            if (remaining > 0) {
              const timer = setTimeout(() => {
                timers.delete(data.sessionId);
                try {
                  endQuestion(data.sessionId);
                  io.to(`session:${data.sessionId}`).emit("game:questionEnd");
                } catch (e) {
                  console.error("Error in resume timeout:", e);
                }
              }, remaining);
              timers.set(data.sessionId, timer);
            }
          }
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "لا يمكن الاستئناف" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:kick", (data: { sessionId: string; hostKey: string; playerId: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "غير مصرح" });
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
          callback?.({ success: false, error: "اللاعب غير موجود" });
        }
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    });

    socket.on("host:restart", (data: { sessionId: string; hostKey: string }, callback) => {
      try {
        const session = getSession(data.sessionId);
        if (!session || session.hostKey !== data.hostKey) {
          callback?.({ success: false, error: "غير مصرح" });
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
          callback?.({ success: false, error: "لا يمكن إعادة التشغيل" });
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
