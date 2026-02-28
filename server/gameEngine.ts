import { randomUUID } from "crypto";
import type {
  GameSession,
  Question,
  Player,
  PlayerAnswer,
  LeaderboardEntry,
  QuestionReveal,
  FinalStats,
  QuestionForBigScreen,
  QuestionForPlayer,
  PlayerFeedback,
} from "@shared/schema";

function generateHostKey(): string {
  return randomUUID();
}

const sessions = new Map<string, GameSession>();

export function createSession(questions: Question[], defaultTimeLimit: number = 30): GameSession {
  const id = randomUUID();
  const hostKey = generateHostKey();

  let doublePointsIndex = -1;
  if (questions.length >= 3) {
    doublePointsIndex = Math.floor(Math.random() * questions.length);
  }

  const session: GameSession = {
    id,
    hostKey,
    questions,
    currentQuestionIndex: -1,
    phase: "LOBBY",
    doublePointsIndex,
    defaultTimeLimit,
    timerStartedAt: null,
    timerDuration: null,
    paused: false,
    pausedTimeRemaining: null,
    players: {},
    answers: [],
    streakAlerts: [],
    previousRanks: {},
    createdAt: Date.now(),
  };

  sessions.set(id, session);
  return session;
}

export function getSession(sessionId: string): GameSession | undefined {
  return sessions.get(sessionId);
}


export function addPlayer(sessionId: string, name: string): Player | null {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "LOBBY") return null;

  const sanitized = name.replace(/[<>&"']/g, "").trim().slice(0, 30);
  if (!sanitized) return null;

  const existing = Object.values(session.players).find(
    (p) => p.name.toLowerCase() === sanitized.toLowerCase()
  );
  if (existing) {
    existing.connected = true;
    return existing;
  }

  const player: Player = {
    id: randomUUID(),
    name: sanitized,
    sessionId,
    score: 0,
    streak: 0,
    bestStreak: 0,
    answeredCount: 0,
    correctCount: 0,
    totalResponseTime: 0,
    fastestCorrectTime: null,
    connected: true,
  };

  session.players[player.id] = player;
  return player;
}

export function reconnectPlayer(sessionId: string, playerId: string): Player | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const player = session.players[playerId];
  if (!player) return null;
  player.connected = true;
  return player;
}

export function disconnectPlayer(sessionId: string, playerId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const player = session.players[playerId];
  if (player) player.connected = false;
}

export function kickPlayer(sessionId: string, playerId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  delete session.players[playerId];
  return true;
}

export function startGame(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "LOBBY" || session.questions.length === 0) return false;
  session.currentQuestionIndex = -1;
  return true;
}

export function nextQuestion(sessionId: string, contextPhase: boolean = false): QuestionForBigScreen | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.currentQuestionIndex++;
  if (session.currentQuestionIndex >= session.questions.length) {
    session.phase = "END";
    return null;
  }

  session.streakAlerts = [];
  const q = session.questions[session.currentQuestionIndex];
  const timeLimit = q.timeLimit || session.defaultTimeLimit;
  session.timerDuration = timeLimit;
  session.paused = false;
  session.pausedTimeRemaining = null;

  if (contextPhase) {
    session.phase = "CONTEXT";
    session.timerStartedAt = null;
  } else {
    session.phase = "QUESTION";
    session.timerStartedAt = Date.now();
  }

  return {
    index: session.currentQuestionIndex,
    context: q.context || undefined,
    text: q.text,
    totalQuestions: session.questions.length,
    timeLimit,
    isDoublePoints: session.currentQuestionIndex === session.doublePointsIndex,
  };
}

export function startQuestionTimer(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.phase = "QUESTION";
  session.timerStartedAt = Date.now();
}

export function getQuestionForPlayer(sessionId: string): QuestionForPlayer | null {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "QUESTION") return null;

  const q = session.questions[session.currentQuestionIndex];
  return {
    index: session.currentQuestionIndex,
    text: q.text,
    options: q.options,
    totalQuestions: session.questions.length,
    timeLimit: q.timeLimit || session.defaultTimeLimit,
    isDoublePoints: session.currentQuestionIndex === session.doublePointsIndex,
  };
}

export function submitAnswer(
  sessionId: string,
  playerId: string,
  answer: "A" | "B" | "C" | "D"
): PlayerFeedback | null {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "QUESTION") return null;

  const player = session.players[playerId];
  if (!player) return null;

  const qi = session.currentQuestionIndex;
  const alreadyAnswered = session.answers.find(
    (a) => a.playerId === playerId && a.questionIndex === qi
  );
  if (alreadyAnswered) return null;

  if (!session.timerStartedAt || !session.timerDuration) return null;

  const elapsed = Date.now() - session.timerStartedAt;
  const timeLimitMs = session.timerDuration * 1000;
  if (elapsed > timeLimitMs + 2000) return null;

  const q = session.questions[qi];
  const isCorrect = answer === q.correct;
  const responseTimeMs = Math.min(elapsed, timeLimitMs);

  let points = 0;
  if (isCorrect) {
    const basePoints = 1000;
    const remaining = Math.max(0, timeLimitMs - responseTimeMs);
    const speedBonus = Math.round((remaining / timeLimitMs) * 300);
    points = basePoints + speedBonus;

    if (qi === session.doublePointsIndex) {
      points *= 2;
    }

    player.streak++;
    if (player.streak > player.bestStreak) {
      player.bestStreak = player.streak;
    }

    let streakBonus = false;
    if (player.streak >= 3 && player.streak % 3 === 0) {
      let bonus = 500;
      if (qi === session.doublePointsIndex) bonus *= 2;
      points += bonus;
      streakBonus = true;
      session.streakAlerts.push({ playerName: player.name, streak: player.streak });
    }

    player.correctCount++;
    if (player.fastestCorrectTime === null || responseTimeMs < player.fastestCorrectTime) {
      player.fastestCorrectTime = responseTimeMs;
    }

    player.score += points;
    player.answeredCount++;
    player.totalResponseTime += responseTimeMs;

    const pa: PlayerAnswer = {
      playerId,
      questionIndex: qi,
      answer,
      timeMs: responseTimeMs,
      points,
      correct: true,
    };
    session.answers.push(pa);

    const leaderboard = getLeaderboard(sessionId);
    const rank = leaderboard.findIndex((e) => e.playerId === playerId) + 1;

    return {
      correct: true,
      correctAnswer: q.correct,
      pointsGained: points,
      totalScore: player.score,
      rank,
      streak: player.streak,
      streakBonus,
    };
  } else {
    player.streak = 0;
    player.answeredCount++;
    player.totalResponseTime += responseTimeMs;

    const pa: PlayerAnswer = {
      playerId,
      questionIndex: qi,
      answer,
      timeMs: responseTimeMs,
      points: 0,
      correct: false,
    };
    session.answers.push(pa);

    const leaderboard = getLeaderboard(sessionId);
    const rank = leaderboard.findIndex((e) => e.playerId === playerId) + 1;

    return {
      correct: false,
      correctAnswer: q.correct,
      pointsGained: 0,
      totalScore: player.score,
      rank: rank || Object.keys(session.players).length,
      streak: 0,
      streakBonus: false,
    };
  }
}

export function endQuestion(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  const qi = session.currentQuestionIndex;
  const playerIds = Object.keys(session.players);
  for (const pid of playerIds) {
    const answered = session.answers.find(
      (a) => a.playerId === pid && a.questionIndex === qi
    );
    if (!answered) {
      session.players[pid].streak = 0;
      session.answers.push({
        playerId: pid,
        questionIndex: qi,
        answer: null,
        timeMs: 0,
        points: 0,
        correct: false,
      });
    }
  }
}

export function getLeaderboard(sessionId: string): LeaderboardEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  const entries: LeaderboardEntry[] = Object.values(session.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      playerId: p.id,
      name: p.name,
      score: p.score,
      rank: i + 1,
      previousRank: session.previousRanks[p.id] ?? null,
      streak: p.streak,
    }));

  return entries;
}

export function saveRanks(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const lb = getLeaderboard(sessionId);
  session.previousRanks = {};
  for (const e of lb) {
    session.previousRanks[e.playerId] = e.rank;
  }
}

export function getReveal(sessionId: string): QuestionReveal | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const qi = session.currentQuestionIndex;
  const q = session.questions[qi];
  const qAnswers = session.answers.filter((a) => a.questionIndex === qi);

  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const a of qAnswers) {
    if (a.answer) dist[a.answer]++;
  }

  const total = qAnswers.length || 1;
  const pct: Record<string, number> = {
    A: Math.round((dist.A / total) * 100),
    B: Math.round((dist.B / total) * 100),
    C: Math.round((dist.C / total) * 100),
    D: Math.round((dist.D / total) * 100),
  };

  const correctAnswers = qAnswers
    .filter((a) => a.correct)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, 3)
    .map((a) => ({
      name: session.players[a.playerId]?.name || "Unknown",
      timeMs: a.timeMs,
    }));

  session.phase = "REVEAL";

  const lb = getLeaderboard(sessionId);

  return {
    questionIndex: qi,
    correct: q.correct,
    options: q.options,
    distribution: dist,
    percentages: pct,
    topFastest: correctAnswers,
    leaderboard: lb.slice(0, 5),
    isDoublePoints: qi === session.doublePointsIndex,
  };
}

export function showLeaderboard(sessionId: string): LeaderboardEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  session.phase = "LEADERBOARD";
  saveRanks(sessionId);
  return getLeaderboard(sessionId);
}

export function endGame(sessionId: string): FinalStats | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.phase = "END";

  const players = Object.values(session.players);
  const answers = session.answers;

  let fastestCorrect: FinalStats["fastestCorrect"] = null;
  const correctAnswers = answers.filter((a) => a.correct);
  if (correctAnswers.length > 0) {
    const fastest = correctAnswers.reduce((min, a) => (a.timeMs < min.timeMs ? a : min));
    const player = session.players[fastest.playerId];
    fastestCorrect = {
      playerName: player?.name || "Unknown",
      timeMs: fastest.timeMs,
      questionIndex: fastest.questionIndex,
    };
  }

  let bestStreak: FinalStats["bestStreak"] = null;
  if (players.length > 0) {
    const best = players.reduce((max, p) => (p.bestStreak > max.bestStreak ? p : max));
    if (best.bestStreak > 0) {
      bestStreak = { playerName: best.name, streakLength: best.bestStreak };
    }
  }

  let hardestQuestion: FinalStats["hardestQuestion"] = null;
  if (session.questions.length > 0) {
    let lowestPct = 101;
    let hardestIdx = 0;
    for (let i = 0; i < session.questions.length; i++) {
      const qAnswers = answers.filter((a) => a.questionIndex === i);
      const total = qAnswers.length || 1;
      const correctCount = qAnswers.filter((a) => a.correct).length;
      const pct = (correctCount / total) * 100;
      if (pct < lowestPct) {
        lowestPct = pct;
        hardestIdx = i;
      }
    }
    hardestQuestion = {
      questionIndex: hardestIdx,
      questionText: session.questions[hardestIdx].text,
      correctPercent: Math.round(lowestPct),
    };
  }

  const answeredEntries = answers.filter((a) => a.answer !== null);
  const avgResponseTime =
    answeredEntries.length > 0
      ? Math.round(answeredEntries.reduce((s, a) => s + a.timeMs, 0) / answeredEntries.length)
      : 0;

  const totalQ = session.questions.length;
  const playerCount = players.length || 1;
  const playersWhoAnsweredMost = players.filter(
    (p) => p.answeredCount >= totalQ * 0.5
  ).length;
  const participationRate = Math.round((playersWhoAnsweredMost / playerCount) * 100);

  const leaderboard = getLeaderboard(sessionId);
  const podium = leaderboard.slice(0, 3);
  const winner = podium[0] || null;

  return {
    fastestCorrect,
    bestStreak,
    hardestQuestion,
    avgResponseTime,
    participationRate,
    totalPlayers: players.length,
    totalQuestions: totalQ,
    winner,
    podium,
    fullLeaderboard: leaderboard,
  };
}

export function pauseGame(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "QUESTION" || session.paused) return false;

  if (session.timerStartedAt && session.timerDuration) {
    const elapsed = Date.now() - session.timerStartedAt;
    const remaining = session.timerDuration * 1000 - elapsed;
    session.pausedTimeRemaining = Math.max(0, remaining);
  }
  session.paused = true;
  return true;
}

export function resumeGame(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.paused) return false;

  if (session.pausedTimeRemaining !== null) {
    session.timerStartedAt = Date.now() - (session.timerDuration! * 1000 - session.pausedTimeRemaining);
  }
  session.paused = false;
  session.pausedTimeRemaining = null;
  return true;
}

export function restartGame(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.currentQuestionIndex = -1;
  session.phase = "LOBBY";
  session.timerStartedAt = null;
  session.timerDuration = null;
  session.paused = false;
  session.pausedTimeRemaining = null;
  session.answers = [];
  session.streakAlerts = [];
  session.previousRanks = {};

  if (session.questions.length >= 3) {
    session.doublePointsIndex = Math.floor(Math.random() * session.questions.length);
  }

  session.players = {};

  return true;
}

export function getPlayerCount(sessionId: string): number {
  const session = sessions.get(sessionId);
  return session ? Object.keys(session.players).length : 0;
}

export function getPlayerList(sessionId: string): { id: string; name: string }[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return Object.values(session.players).map((p) => ({ id: p.id, name: p.name }));
}

export function getAllSessions(): GameSession[] {
  return Array.from(sessions.values());
}

export function deleteSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  sessions.delete(sessionId);
  return true;
}
