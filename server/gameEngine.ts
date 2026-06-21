import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { REGIONS, REGION_KEYS } from "@shared/schema";
import type {
  GameSession,
  Question,
  Player,
  PlayerAnswer,
  LeaderboardEntry,
  QuestionReveal,
  FinalStats,
  RegionResult,
  RegionKey,
  QuestionForBigScreen,
  QuestionForPlayer,
  PlayerFeedback,
} from "@shared/schema";

function generateHostKey(): string {
  return randomUUID();
}

// Deterministic ranking: score, then best streak, then fastest correct answer,
// then name. Prevents random ordering at a region's prize cutoff on ties.
function rankComparator(a: Player, b: Player): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak;
  const af = a.fastestCorrectTime ?? Infinity;
  const bf = b.fastestCorrectTime ?? Infinity;
  if (af !== bf) return af - bf;
  return a.name.localeCompare(b.name);
}

const sessions = new Map<string, GameSession>();

// Bounds so anyone calling host:create (it is unauthenticated by design) cannot
// grow memory without limit, and stale sessions don't accumulate forever.
const MAX_SESSIONS = 200;
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h — abandoned games that never finished
// Finished games hold the winners. Keep them for 30 days FROM WHEN THEY ENDED so
// the results stay retrievable long after the event (download the CSV anytime).
const WINNERS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function reapStaleSessions(): void {
  const now = Date.now();
  for (const [id, s] of Array.from(sessions.entries())) {
    if (s.phase === "END") {
      if (now - (s.endedAt ?? s.createdAt) > WINNERS_RETENTION_MS) sessions.delete(id);
    } else if (now - s.createdAt > SESSION_MAX_AGE_MS) {
      sessions.delete(id);
    }
  }
}

setInterval(reapStaleSessions, 10 * 60 * 1000).unref?.();

// ---------------------------------------------------------------------------
// Crash/restart persistence. Game state lives in memory, so a process restart
// mid-event would normally wipe every session. We snapshot to disk every few
// seconds (and on shutdown) and reload on boot. Clients auto-reconnect via
// player:reconnect / host:reconnect (ids kept in localStorage), repopulating
// the socket rooms. Note: question auto-advance timers are NOT restored — after
// a restart the host drives the round manually (reveal/next still work).
// ---------------------------------------------------------------------------
// Sessions persist to DATA_DIR if set (point this at a Railway/host VOLUME so
// state survives restarts & redeploys), otherwise to ./data. Question bank stays
// in the repo at ./data/questions.json regardless.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const SAVE_INTERVAL_MS = 2000;

function serializeSessions(): string {
  // answersIndex (a Map) is rebuilt from `answers` on load, so we drop it here.
  return JSON.stringify(
    Array.from(sessions.values()),
    (key, value) => (key === "answersIndex" ? undefined : value),
  );
}

function persistSessions(sync = false): void {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = serializeSessions();
    if (sync) fs.writeFileSync(SESSIONS_FILE, data, "utf-8");
    else fs.writeFile(SESSIONS_FILE, data, "utf-8", () => {});
  } catch (e) {
    console.error("Failed to persist sessions:", e);
  }
}

// Periodic snapshot: coalesces all state changes and survives hard crashes
// (worst case we lose ~2s). A graceful restart additionally flushes on exit.
setInterval(() => {
  if (sessions.size > 0) persistSessions(false);
}, SAVE_INTERVAL_MS).unref?.();

function restoreSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    let restored = 0;
    for (const s of arr) {
      if (!s || typeof s.id !== "string") continue;
      if (s.phase === "END") {
        if (now - (s.endedAt ?? s.createdAt ?? 0) > WINNERS_RETENTION_MS) continue;
      } else if (now - (s.createdAt ?? 0) > SESSION_MAX_AGE_MS) {
        continue;
      }
      // Mark everyone disconnected until their socket reconnects.
      for (const pid of Object.keys(s.players || {})) {
        s.players[pid].connected = false;
      }
      // Rebuild the answers index from the answers array.
      s.answersIndex = new Map();
      for (const a of s.answers || []) {
        s.answersIndex.set(`${a.playerId}:${a.questionIndex}`, a);
      }
      sessions.set(s.id, s as GameSession);
      restored++;
    }
    if (restored > 0) console.log(`Restored ${restored} session(s) from disk`);
  } catch (e) {
    console.error("Failed to restore sessions:", e);
  }
}

restoreSessions();

// Flush synchronously on shutdown so an intentional restart loses nothing.
process.on("SIGTERM", () => { persistSessions(true); process.exit(0); });
process.on("SIGINT", () => { persistSessions(true); process.exit(0); });

export function createSession(questions: Question[], defaultTimeLimit: number = 30): GameSession {
  reapStaleSessions();
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error("Too many active sessions");
  }

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
    answersIndex: new Map(),
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


export type AddPlayerResult =
  | { ok: true; player: Player }
  | { ok: false; reason: "invalid" | "name" | "email" };

export function addPlayer(sessionId: string, name: string, email: string, region: string = ""): AddPlayerResult {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "LOBBY") return { ok: false, reason: "invalid" };

  const sanitized = name.replace(/[<>&"']/g, "").trim().slice(0, 60);
  if (!sanitized) return { ok: false, reason: "invalid" };

  const sanitizedEmail = email.trim().toLowerCase().slice(0, 120);
  const validRegion = (REGION_KEYS as string[]).includes(region) ? (region as RegionKey) : "";

  const existing = Object.values(session.players);
  // Names must be unique. Previously a same-name join silently took over the
  // existing player (and their score) — at a large event two genuine "Ahmed"s
  // would collide. Reject instead; the join handler tells them to pick another.
  // (Legitimate refresh/reconnect goes through player:reconnect by playerId,
  // not by name, so this does not break normal reconnection.)
  if (existing.some((p) => p.name.toLowerCase() === sanitized.toLowerCase())) {
    return { ok: false, reason: "name" };
  }
  // Emails must be unique too — one person can't register twice.
  if (sanitizedEmail && existing.some((p) => p.email === sanitizedEmail)) {
    return { ok: false, reason: "email" };
  }

  const player: Player = {
    id: randomUUID(),
    name: sanitized,
    email: sanitizedEmail,
    region: validRegion,
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
  return { ok: true, player };
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
    category: q.category || undefined,
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

// Read-only current question for the big screen (no side effects). Used to
// hydrate a display that joins/refreshes mid-question so it isn't blank.
export function getBigScreenQuestion(sessionId: string): QuestionForBigScreen | null {
  const session = sessions.get(sessionId);
  if (!session || session.currentQuestionIndex < 0) return null;
  const q = session.questions[session.currentQuestionIndex];
  if (!q) return null;
  return {
    index: session.currentQuestionIndex,
    context: q.context || undefined,
    category: q.category || undefined,
    text: q.text,
    totalQuestions: session.questions.length,
    timeLimit: q.timeLimit || session.defaultTimeLimit,
    isDoublePoints: session.currentQuestionIndex === session.doublePointsIndex,
  };
}

export function getQuestionForPlayer(sessionId: string): QuestionForPlayer | null {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "QUESTION") return null;

  const q = session.questions[session.currentQuestionIndex];
  return {
    index: session.currentQuestionIndex,
    text: q.text,
    category: q.category || undefined,
    options: q.options,
    totalQuestions: session.questions.length,
    timeLimit: q.timeLimit || session.defaultTimeLimit,
    isDoublePoints: session.currentQuestionIndex === session.doublePointsIndex,
  };
}

function getRank(session: GameSession, playerId: string): number {
  const players = Object.values(session.players);
  const myScore = session.players[playerId]?.score ?? 0;
  let rank = 1;
  for (const p of players) {
    if (p.score > myScore) rank++;
  }
  return rank;
}

export function submitAnswer(
  sessionId: string,
  playerId: string,
  answer: "A" | "B" | "C" | "D"
): PlayerFeedback | null {
  const session = sessions.get(sessionId);
  if (!session || session.phase !== "QUESTION" || session.paused) return null;

  const player = session.players[playerId];
  if (!player) return null;

  const qi = session.currentQuestionIndex;
  const answerKey = `${playerId}:${qi}`;
  if (session.answersIndex.has(answerKey)) return null;

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
    session.answersIndex.set(answerKey, pa);

    const rank = getRank(session, playerId);

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
    session.answersIndex.set(answerKey, pa);

    const rank = getRank(session, playerId);

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
    const key = `${pid}:${qi}`;
    if (!session.answersIndex.has(key)) {
      session.players[pid].streak = 0;
      const pa: PlayerAnswer = {
        playerId: pid,
        questionIndex: qi,
        answer: null,
        timeMs: 0,
        points: 0,
        correct: false,
      };
      session.answers.push(pa);
      session.answersIndex.set(key, pa);
    }
  }
}

export function getLeaderboard(sessionId: string): LeaderboardEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  const entries: LeaderboardEntry[] = Object.values(session.players)
    .sort(rankComparator)
    .map((p, i) => ({
      playerId: p.id,
      name: p.name,
      score: p.score,
      rank: i + 1,
      previousRank: session.previousRanks[p.id] ?? null,
      streak: p.streak,
      region: p.region,
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

  const streakPlayers = session.streakAlerts.map((a) => ({
    playerName: a.playerName,
    streak: a.streak,
  }));

  const reveal: QuestionReveal = {
    questionIndex: qi,
    correct: q.correct,
    options: q.options,
    distribution: dist,
    percentages: pct,
    topFastest: correctAnswers,
    leaderboard: lb.slice(0, 3),
    isDoublePoints: qi === session.doublePointsIndex,
    streakPlayers,
  };
  session.lastReveal = reveal;
  return reveal;
}

export function showLeaderboard(sessionId: string): LeaderboardEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  session.phase = "LEADERBOARD";
  saveRanks(sessionId);
  const lb = getLeaderboard(sessionId);
  session.lastLeaderboard = lb;
  return lb;
}

export function endGame(sessionId: string): FinalStats | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.phase = "END";
  session.endedAt = Date.now();

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
  {
    let lowestPct = 101;
    let hardestIdx = -1;
    // Only consider questions that were actually reached (have answer rows).
    // Otherwise ending the game early reports an unasked question as "hardest".
    for (let i = 0; i < session.questions.length; i++) {
      const qAnswers = answers.filter((a) => a.questionIndex === i);
      if (qAnswers.length === 0) continue;
      const correctCount = qAnswers.filter((a) => a.correct).length;
      const pct = (correctCount / qAnswers.length) * 100;
      if (pct < lowestPct) {
        lowestPct = pct;
        hardestIdx = i;
      }
    }
    if (hardestIdx >= 0) {
      hardestQuestion = {
        questionIndex: hardestIdx,
        questionText: session.questions[hardestIdx].text,
        correctPercent: Math.round(lowestPct),
      };
    }
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

  // Winners grouped by region: top N per region (counts defined in REGIONS),
  // ranked within the region.
  const regionResults: RegionResult[] = REGIONS.map((r) => {
    const winners = leaderboard
      .filter((e) => e.region === r.key)
      .slice(0, r.winners)
      .map((e, i) => ({ ...e, rank: i + 1 }));
    return { key: r.key, label: r.label, winnerCount: r.winners, winners };
  });

  const stats: FinalStats = {
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
    regionResults,
  };
  session.lastStats = stats;
  return stats;
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
  session.answersIndex = new Map();
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

export function getPlayerList(sessionId: string): { id: string; name: string; region: string }[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return Object.values(session.players).map((p) => ({ id: p.id, name: p.name, region: p.region }));
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

export function getWinnersWithEmail(sessionId: string): { rank: number; name: string; email: string; score: number }[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  const sorted = Object.values(session.players).sort(rankComparator);
  return sorted.slice(0, 3).map((p, i) => ({
    rank: i + 1,
    name: p.name,
    email: p.email,
    score: p.score,
  }));
}

// Contactable winners grouped by region (top N per region, with emails)
// for the organizers to reach out after the event.
export function getRegionWinnersWithEmail(sessionId: string): {
  key: RegionKey;
  label: string;
  winnerCount: number;
  winners: { rank: number; name: string; email: string; score: number }[];
}[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  const sorted = Object.values(session.players).sort(rankComparator);
  return REGIONS.map((r) => ({
    key: r.key,
    label: r.label,
    winnerCount: r.winners,
    winners: sorted
      .filter((p) => p.region === r.key)
      .slice(0, r.winners)
      .map((p, i) => ({ rank: i + 1, name: p.name, email: p.email, score: p.score })),
  }));
}
