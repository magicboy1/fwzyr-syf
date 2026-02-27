import type { Question } from "@shared/schema";
import { randomUUID } from "crypto";

export const sampleQuestions: Question[] = [
  {
    id: randomUUID(),
    text: "ما هي عاصمة المملكة العربية السعودية؟",
    options: ["جدة", "الرياض", "مكة المكرمة", "المدينة المنورة"],
    correct: "B",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "What is the tallest building in the world?",
    options: ["Shanghai Tower", "Burj Khalifa", "Abraj Al-Bait", "Lotte World Tower"],
    correct: "B",
    category: "Geography",
  },
  {
    id: randomUUID(),
    text: "كم عدد أركان الإسلام؟",
    options: ["ثلاثة", "أربعة", "خمسة", "ستة"],
    correct: "C",
    category: "إسلاميات",
  },
  {
    id: randomUUID(),
    text: "In which year was the Kingdom of Saudi Arabia founded?",
    options: ["1920", "1925", "1932", "1945"],
    correct: "C",
    category: "History",
  },
  {
    id: randomUUID(),
    text: "ما هو أطول نهر في العالم؟",
    options: ["نهر الأمازون", "نهر النيل", "نهر المسيسيبي", "نهر اليانغتسي"],
    correct: "B",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "Which planet is known as the Red Planet?",
    options: ["Venus", "Jupiter", "Mars", "Saturn"],
    correct: "C",
    category: "Science",
  },
  {
    id: randomUUID(),
    text: "ما هي أكبر دولة عربية من حيث المساحة؟",
    options: ["مصر", "السعودية", "الجزائر", "السودان"],
    correct: "C",
    category: "جغرافيا",
  },
  {
    id: randomUUID(),
    text: "How many players are on a football (soccer) team?",
    options: ["9", "10", "11", "12"],
    correct: "C",
    category: "Sports",
  },
  {
    id: randomUUID(),
    text: "من هو مؤسس شركة أبل؟",
    options: ["بيل غيتس", "ستيف جوبز", "مارك زوكربيرغ", "إيلون ماسك"],
    correct: "B",
    category: "تكنولوجيا",
  },
  {
    id: randomUUID(),
    text: "What is the chemical symbol for gold?",
    options: ["Ag", "Fe", "Au", "Cu"],
    correct: "C",
    category: "Science",
  },
];
