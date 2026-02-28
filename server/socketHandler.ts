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

export function setupSocketIO(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    let currentSessionId: string | null = null;
    let currentPlayerId: string | null = null;
    let isHost = false;

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
    });

    socket.on("display:join", (data: { sessionId: string }, callback) => {
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
    });

    socket.on("player:join", (data: { sessionId: string; name: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session) {
        callback?.({ success: false, error: "اللعبة غير موجودة." });
        return;
      }
      if (session.phase !== "LOBBY") {
        callback?.({ success: false, error: "اللعبة بدأت بالفعل." });
        return;
      }

      const player = addPlayer(session.id, data.name);
      if (!player) {
        callback?.({ success: false, error: "تعذر الانضمام. جرب اسم مختلف." });
        return;
      }

      currentSessionId = session.id;
      currentPlayerId = player.id;
      socket.join(`session:${session.id}`);
      socket.join(`player:${player.id}`);

      io.to(`session:${session.id}`).emit("game:playerJoined", {
        player: { id: player.id, name: player.name },
        playerCount: getPlayerCount(session.id),
        players: getPlayerList(session.id),
      });

      callback?.({
        success: true,
        playerId: player.id,
        sessionId: session.id,
        playerName: player.name,
      });
      log(`Player joined: ${player.name} -> ${session.id}`, "socket");
    });

    socket.on("player:reconnect", (data: { sessionId: string; playerId: string }, callback) => {
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
        const alreadyAnswered = session.answers.find(
          (a) => a.playerId === data.playerId && a.questionIndex === session.currentQuestionIndex
        );
        response.alreadyAnswered = !!alreadyAnswered;
      }

      callback?.(response);
    });

    socket.on("host:start", (data: { sessionId: string; hostKey: string }, callback) => {
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
    });

    socket.on("host:next", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      const oldTimer = timers.get(data.sessionId);
      if (oldTimer) clearTimeout(oldTimer);

      const isDoublePoints = session.currentQuestionIndex + 1 === session.doublePointsIndex;
      if (isDoublePoints) {
        io.to(`session:${data.sessionId}`).emit("game:doublePoints");
        setTimeout(() => {
          emitNextQuestion(data.sessionId);
        }, 3000);
      } else {
        emitNextQuestion(data.sessionId);
      }
      callback?.({ success: true });
    });

    const CONTEXT_DURATION = 3000;
    const contextTimers = new Map<string, NodeJS.Timeout>();

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
      const session = getSession(sessionId)!;
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
        endQuestion(sessionId);
        io.to(`session:${sessionId}`).emit("game:questionEnd");

        setTimeout(() => {
          const session = getSession(sessionId);
          const reveal = getReveal(sessionId);
          if (reveal && session) {
            const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
            io.to(`session:${sessionId}`).emit("game:reveal", { reveal, isLastQuestion });
          }
        }, 1500);
      }, (question.timeLimit + 1) * 1000);
      timers.set(sessionId, timer);
    }

    socket.on("player:answer", (data: { sessionId: string; playerId: string; answer: "A" | "B" | "C" | "D" }, callback) => {
      const feedback = submitAnswer(data.sessionId, data.playerId, data.answer);
      if (!feedback) {
        callback?.({ success: false, error: "تعذر تسجيل الإجابة" });
        return;
      }

      callback?.({ success: true, feedback });

      const session = getSession(data.sessionId);
      if (session) {
        const answeredCount = session.answers.filter(
          (a) => a.questionIndex === session.currentQuestionIndex
        ).length;
        const updateData = {
          answeredCount,
          totalPlayers: getPlayerCount(data.sessionId),
        };
        io.to(`host:${data.sessionId}`).emit("game:answerUpdate", updateData);
        io.to(`display:${data.sessionId}`).emit("game:answerUpdate", updateData);

        if (session.streakAlerts.length > 0) {
          const latestAlert = session.streakAlerts[session.streakAlerts.length - 1];
          io.to(`display:${data.sessionId}`).emit("game:streakAlert", latestAlert);
        }
      }
    });

    socket.on("host:reveal", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      const oldCtx = contextTimers.get(data.sessionId);
      if (oldCtx) { clearTimeout(oldCtx); contextTimers.delete(data.sessionId); }
      const oldTimer = timers.get(data.sessionId);
      if (oldTimer) clearTimeout(oldTimer);

      endQuestion(data.sessionId);
      const reveal = getReveal(data.sessionId);
      if (!reveal) {
        callback?.({ success: false, error: "لا يوجد سؤال للكشف" });
        return;
      }

      const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
      io.to(`session:${data.sessionId}`).emit("game:reveal", { reveal, isLastQuestion });
      callback?.({ success: true, isLastQuestion });
    });

    socket.on("host:leaderboard", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      const leaderboard = showLeaderboard(data.sessionId);
      const isLastQuestion = session.currentQuestionIndex >= session.questions.length - 1;
      io.to(`session:${data.sessionId}`).emit("game:leaderboard", { leaderboard, isLastQuestion });
      callback?.({ success: true, isLastQuestion });
    });

    socket.on("host:end", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      const oldCtx2 = contextTimers.get(data.sessionId);
      if (oldCtx2) { clearTimeout(oldCtx2); contextTimers.delete(data.sessionId); }
      const oldTimer = timers.get(data.sessionId);
      if (oldTimer) clearTimeout(oldTimer);

      const stats = endGame(data.sessionId);
      io.to(`session:${data.sessionId}`).emit("game:end", { stats });
      callback?.({ success: true });
    });

    socket.on("host:pause", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      if (pauseGame(data.sessionId)) {
        const oldTimer = timers.get(data.sessionId);
        if (oldTimer) clearTimeout(oldTimer);
        io.to(`session:${data.sessionId}`).emit("game:paused");
        callback?.({ success: true });
      } else {
        callback?.({ success: false, error: "لا يمكن الإيقاف" });
      }
    });

    socket.on("host:resume", (data: { sessionId: string; hostKey: string }, callback) => {
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
              endQuestion(data.sessionId);
              io.to(`session:${data.sessionId}`).emit("game:questionEnd");
            }, remaining);
            timers.set(data.sessionId, timer);
          }
        }
        callback?.({ success: true });
      } else {
        callback?.({ success: false, error: "لا يمكن الاستئناف" });
      }
    });

    socket.on("host:kick", (data: { sessionId: string; hostKey: string; playerId: string }, callback) => {
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
    });

    socket.on("host:restart", (data: { sessionId: string; hostKey: string }, callback) => {
      const session = getSession(data.sessionId);
      if (!session || session.hostKey !== data.hostKey) {
        callback?.({ success: false, error: "غير مصرح" });
        return;
      }

      const oldCtx3 = contextTimers.get(data.sessionId);
      if (oldCtx3) { clearTimeout(oldCtx3); contextTimers.delete(data.sessionId); }

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
    });

    socket.on("time:sync", (callback) => {
      callback?.({ serverTime: Date.now() });
    });

    socket.on("disconnect", () => {
      if (currentSessionId && currentPlayerId) {
        disconnectPlayer(currentSessionId, currentPlayerId);
      }
    });
  });

  return io;
}
