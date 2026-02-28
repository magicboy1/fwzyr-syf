import type { Express } from "express";
import { type Server } from "http";
import { setupSocketIO } from "./socketHandler";
import { sampleQuestions } from "./sampleQuestions";
import { randomUUID } from "crypto";
import type { Question } from "@shared/schema";
import { z } from "zod";
import fs from "fs";
import path from "path";

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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSocketIO(httpServer);

  app.get("/api/questions", (_req, res) => {
    res.json(questionBank);
  });

  app.post("/api/questions", (req, res) => {
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

  app.put("/api/questions/:id", (req, res) => {
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

  app.delete("/api/questions/:id", (req, res) => {
    const idx = questionBank.findIndex((q) => q.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    questionBank.splice(idx, 1);
    saveQuestions(questionBank);
    res.json({ success: true });
  });

  app.post("/api/questions/import", (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      res.status(400).json({ error: "Expected array of questions" });
      return;
    }
    const imported: Question[] = [];
    for (const q of questions) {
      if (q.text && q.options && q.correct) {
        const question: Question = {
          id: randomUUID(),
          context: q.context || undefined,
          text: q.text,
          options: q.options,
          correct: q.correct,
          category: q.category || undefined,
          timeLimit: q.timeLimit || undefined,
        };
        questionBank.push(question);
        imported.push(question);
      }
    }
    saveQuestions(questionBank);
    res.json({ imported: imported.length, questions: imported });
  });

  app.get("/api/questions/export", (_req, res) => {
    res.json(questionBank);
  });

  app.get("/api/time", (_req, res) => {
    res.json({ serverTime: Date.now() });
  });

  return httpServer;
}
