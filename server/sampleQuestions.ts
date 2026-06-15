import type { Question } from "@shared/schema";
import { randomUUID } from "crypto";

// Fallback question bank, only used if data/questions.json is missing or empty.
// The real event questions live in data/questions.json.
export const sampleQuestions: Question[] = [
  {
    id: randomUUID(),
    text: "Which behavior best reflects accountability?",
    options: [
      "Escalating every problem",
      "Avoiding difficult tasks",
      "Taking responsibility for outcomes",
      "Focusing only on speed",
    ],
    correct: "C",
    category: "Sample",
    timeLimit: 20,
  },
  {
    id: randomUUID(),
    text: "Long-term trust is usually built through:",
    options: [
      "Consistent actions and reliability",
      "Fast responses under pressure",
      "Strong presentation skills",
      "High project visibility",
    ],
    correct: "A",
    category: "Sample",
    timeLimit: 20,
  },
  {
    id: randomUUID(),
    text: "A future-ready culture usually encourages:",
    options: [
      "Minimal testing",
      "Strict process control",
      "Continuous improvement",
      "Limited operational change",
    ],
    correct: "C",
    category: "Sample",
    timeLimit: 20,
  },
];
