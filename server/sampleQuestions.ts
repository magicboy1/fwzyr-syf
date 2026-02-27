import type { Question } from "@shared/schema";
import { randomUUID } from "crypto";

export const sampleQuestions: Question[] = [
  {
    id: randomUUID(),
    text: "ما هي عاصمة المملكة العربية السعودية؟",
    options: ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة"],
    correct: "A",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "What is the tallest building in the world?",
    options: ["Shanghai Tower", "Abraj Al-Bait", "Lotte World Tower", "Burj Khalifa"],
    correct: "D",
    category: "Geography",
  },
  {
    id: randomUUID(),
    text: "كم عدد أركان الإسلام؟",
    options: ["ثلاثة", "ستة", "أربعة", "خمسة"],
    correct: "D",
    category: "إسلاميات",
  },
  {
    id: randomUUID(),
    text: "In which year was the Kingdom of Saudi Arabia founded?",
    options: ["1945", "1932", "1920", "1925"],
    correct: "B",
    category: "History",
  },
  {
    id: randomUUID(),
    text: "ما هو أطول نهر في العالم؟",
    options: ["نهر المسيسيبي", "نهر اليانغتسي", "نهر النيل", "نهر الأمازون"],
    correct: "C",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "Which planet is known as the Red Planet?",
    options: ["Mars", "Venus", "Jupiter", "Saturn"],
    correct: "A",
    category: "Science",
  },
  {
    id: randomUUID(),
    text: "ما هي أكبر دولة عربية من حيث المساحة؟",
    options: ["مصر", "السودان", "السعودية", "الجزائر"],
    correct: "D",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "How many players are on a football (soccer) team?",
    options: ["9", "12", "11", "10"],
    correct: "C",
    category: "Sports",
  },
  {
    id: randomUUID(),
    text: "من هو مؤسس شركة أبل؟",
    options: ["مارك زوكربيرغ", "ستيف جوبز", "إيلون ماسك", "بيل غيتس"],
    correct: "B",
    category: "تكنولوجيا",
  },
  {
    id: randomUUID(),
    text: "What is the chemical symbol for gold?",
    options: ["Fe", "Cu", "Ag", "Au"],
    correct: "D",
    category: "Science",
  },
];
