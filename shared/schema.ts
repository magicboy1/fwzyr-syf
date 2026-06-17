import { z } from "zod";

export const questionSchema = z.object({
  id: z.string(),
  context: z.string().optional(),
  text: z.string().min(1),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  correct: z.enum(["A", "B", "C", "D"]),
  category: z.string().optional(),
  timeLimit: z.number().min(5).max(120).optional(),
});

export type Question = z.infer<typeof questionSchema>;

export const insertQuestionSchema = questionSchema.omit({ id: true });
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;

// Event regions and how many winners each one awards. Single source of truth
// used by registration, the game engine, and the results screen.
export const REGIONS = [
  { key: "riyadh", label: "Riyadh", winners: 20 },
  { key: "jeddah", label: "Jeddah", winners: 15 },
  { key: "khobar", label: "Al Khobar", winners: 10 },
] as const;
export type RegionKey = (typeof REGIONS)[number]["key"];
export const REGION_KEYS = REGIONS.map((r) => r.key) as RegionKey[];

export interface Player {
  id: string;
  name: string;
  phone: string;
  region: RegionKey | "";
  sessionId: string;
  score: number;
  streak: number;
  bestStreak: number;
  answeredCount: number;
  correctCount: number;
  totalResponseTime: number;
  fastestCorrectTime: number | null;
  connected: boolean;
}

export interface PlayerAnswer {
  playerId: string;
  questionIndex: number;
  answer: "A" | "B" | "C" | "D" | null;
  timeMs: number;
  points: number;
  correct: boolean;
}

export type GamePhase = "LOBBY" | "CONTEXT" | "QUESTION" | "REVEAL" | "LEADERBOARD" | "END";

export interface GameSession {
  id: string;
  hostKey: string;
  questions: Question[];
  currentQuestionIndex: number;
  phase: GamePhase;
  doublePointsIndex: number;
  defaultTimeLimit: number;
  timerStartedAt: number | null;
  timerDuration: number | null;
  paused: boolean;
  pausedTimeRemaining: number | null;
  players: Record<string, Player>;
  answers: PlayerAnswer[];
  answersIndex: Map<string, PlayerAnswer>;
  streakAlerts: { playerName: string; streak: number }[];
  previousRanks: Record<string, number>;
  createdAt: number;
  // Last computed views, so a display that joins/refreshes mid-phase can be
  // hydrated (otherwise the big screen renders blank until the next host action).
  lastReveal?: QuestionReveal | null;
  lastLeaderboard?: LeaderboardEntry[] | null;
  lastStats?: FinalStats | null;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  score: number;
  rank: number;
  previousRank: number | null;
  streak: number;
  region?: RegionKey | "";
}

export interface RegionResult {
  key: RegionKey;
  label: string;
  winnerCount: number;
  winners: LeaderboardEntry[];
}

export interface QuestionReveal {
  questionIndex: number;
  correct: "A" | "B" | "C" | "D";
  options: string[];
  distribution: Record<string, number>;
  percentages: Record<string, number>;
  topFastest: { name: string; timeMs: number }[];
  leaderboard: LeaderboardEntry[];
  isDoublePoints: boolean;
  streakPlayers: { playerName: string; streak: number }[];
}

export interface FinalStats {
  fastestCorrect: { playerName: string; timeMs: number; questionIndex: number } | null;
  bestStreak: { playerName: string; streakLength: number } | null;
  hardestQuestion: { questionIndex: number; questionText: string; correctPercent: number } | null;
  avgResponseTime: number;
  participationRate: number;
  totalPlayers: number;
  totalQuestions: number;
  winner: LeaderboardEntry | null;
  podium: LeaderboardEntry[];
  fullLeaderboard: LeaderboardEntry[];
  regionResults: RegionResult[];
}

export interface QuestionForBigScreen {
  index: number;
  context?: string;
  text: string;
  totalQuestions: number;
  timeLimit: number;
  isDoublePoints: boolean;
}

export interface QuestionForPlayer {
  index: number;
  text: string;
  options: [string, string, string, string];
  totalQuestions: number;
  timeLimit: number;
  isDoublePoints: boolean;
}

export interface PlayerFeedback {
  correct: boolean;
  correctAnswer: "A" | "B" | "C" | "D";
  pointsGained: number;
  totalScore: number;
  rank: number;
  streak: number;
  streakBonus: boolean;
}

export const csvQuestionSchema = z.object({
  context: z.string().optional(),
  text: z.string().min(1),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correct: z.enum(["A", "B", "C", "D"]),
  category: z.string().optional(),
});
