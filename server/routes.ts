import type { Express } from "express";
import { type Server } from "http";
import { setupSocketIO, forceEndSession } from "./socketHandler";
import { sampleQuestions } from "./sampleQuestions";
import { randomUUID, timingSafeEqual, createHmac } from "crypto";
import type { Question } from "@shared/schema";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { getAllSessions, getWinnersWithEmail, getRegionWinnersWithEmail, deleteSession } from "./gameEngine";

const QUESTIONS_FILE = path.join(process.cwd(), "data", "questions.json");

function loadQuestions(): Question[] {
  try {
    if (fs.existsSync(QUESTIONS_FILE)) {
      const raw = fs.readFileSync(QUESTIONS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [...sampleQuestions];
}

function saveQuestions(questions: Question[]) {
  const dir = path.dirname(QUESTIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), "utf-8");
}

const questionBodySchema = z.object({
  context: z.string().nullable().optional(),
  text: z.string().min(1),
  options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  correct: z.enum(["A", "B", "C", "D"]),
  category: z.string().nullable().optional(),
  timeLimit: z.number().min(5).max(120).nullable().optional(),
});

let questionBank: Question[] = loadQuestions();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.warn(
    "[security] ADMIN_PASSWORD is not set — admin endpoints are disabled. " +
      "Set ADMIN_PASSWORD as a secret to enable question management.",
  );
}

// Stateless HMAC-signed session tokens: "<expiry>.<hmac(expiry)>". Verified
// without any server-side store, so they SURVIVE server restarts/redeploys
// (the admin stays logged in instead of being kicked out every restart). Still
// unforgeable (needs the secret) and still expires.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUTH_SECRET = process.env.AUTH_SECRET || ADMIN_PASSWORD || "";

function signExpiry(exp: number): string {
  return createHmac("sha256", AUTH_SECRET).update(String(exp)).digest("hex");
}

function issueToken(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  return `${exp}.${signExpiry(exp)}`;
}

function isValidToken(token: unknown): boolean {
  if (!AUTH_SECRET || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = signExpiry(exp);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function passwordMatches(input: unknown): boolean {
  if (!ADMIN_PASSWORD || typeof input !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Simple in-memory login rate limiter to slow password brute-forcing.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > LOGIN_MAX_ATTEMPTS;
}

function requireAdmin(req: any, res: any, next: any) {
  if (!isValidToken(req.headers["x-admin-token"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSocketIO(httpServer);

  app.post("/api/auth/login", (req, res) => {
    const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
    if (loginRateLimited(ip)) {
      res.status(429).json({ success: false, error: "Too many attempts. Try again later." });
      return;
    }
    if (passwordMatches(req.body?.password)) {
      res.json({ success: true, token: issueToken() });
    } else {
      res.status(401).json({ success: false, error: "Incorrect password" });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    if (isValidToken(req.headers["x-admin-token"])) {
      res.json({ valid: true });
    } else {
      res.status(401).json({ valid: false });
    }
  });

  app.get("/api/questions", requireAdmin, (_req, res) => {
    res.json(questionBank);
  });

  app.post("/api/questions", requireAdmin, (req, res) => {
    const parsed = questionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid question data" });
      return;
    }
    const { context, text, options, correct, category, timeLimit } = parsed.data;
    const question: Question = {
      id: randomUUID(),
      context: context || undefined,
      text,
      options,
      correct,
      category: category || undefined,
      timeLimit: timeLimit || undefined,
    };
    questionBank.push(question);
    saveQuestions(questionBank);
    res.json(question);
  });

  app.put("/api/questions/:id", requireAdmin, (req, res) => {
    const idx = questionBank.findIndex((q) => q.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const parsed = questionBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      return;
    }
    const { context, text, options, correct, category, timeLimit } = parsed.data;
    questionBank[idx] = {
      ...questionBank[idx],
      ...(text && { text }),
      ...(options && { options }),
      ...(correct && { correct }),
      context: context !== undefined ? (context || undefined) : questionBank[idx].context,
      category: category !== undefined ? (category || undefined) : questionBank[idx].category,
      timeLimit: timeLimit !== undefined ? (timeLimit || undefined) : questionBank[idx].timeLimit,
    };
    saveQuestions(questionBank);
    res.json(questionBank[idx]);
  });

  app.delete("/api/questions/:id", requireAdmin, (req, res) => {
    const idx = questionBank.findIndex((q) => q.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    questionBank.splice(idx, 1);
    saveQuestions(questionBank);
    res.json({ success: true });
  });

  app.post("/api/questions/import", requireAdmin, (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      res.status(400).json({ error: "Expected array of questions" });
      return;
    }
    const imported: Question[] = [];
    for (const q of questions) {
      const parsed = questionBodySchema.safeParse(q);
      if (!parsed.success) continue; // skip malformed rows rather than poisoning the bank
      const question: Question = {
        id: randomUUID(),
        context: parsed.data.context || undefined,
        text: parsed.data.text,
        options: parsed.data.options,
        correct: parsed.data.correct,
        category: parsed.data.category || undefined,
        timeLimit: parsed.data.timeLimit || undefined,
      };
      questionBank.push(question);
      imported.push(question);
    }
    saveQuestions(questionBank);
    res.json({ imported: imported.length, questions: imported });
  });

  app.get("/api/questions/export", requireAdmin, (_req, res) => {
    res.json(questionBank);
  });

  app.get("/api/health", (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heap: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
    });
  });

  app.get("/api/time", (_req, res) => {
    res.json({ serverTime: Date.now() });
  });

  app.get("/api/sessions/winners", requireAdmin, (_req, res) => {
    const allSessions = getAllSessions();
    const results = allSessions
      .filter((s) => s.phase === "END" || Object.keys(s.players).length > 0)
      .map((s) => ({
        sessionId: s.id,
        phase: s.phase,
        playerCount: Object.keys(s.players).length,
        createdAt: s.createdAt,
        endedAt: s.endedAt ?? null,
        winners: getWinnersWithEmail(s.id),
        regionWinners: getRegionWinnersWithEmail(s.id),
      }));
    res.json(results);
  });

  app.post("/api/sessions/:id/end", requireAdmin, (req, res) => {
    if (!forceEndSession(req.params.id)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ success: true });
  });

  // Permanently remove a session (e.g. to clean up test/leftover sessions).
  app.delete("/api/sessions/:id", requireAdmin, (req, res) => {
    if (!deleteSession(req.params.id)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ success: true });
  });

  return httpServer;
}
