import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import confetti from "canvas-confetti";
import type { QuestionForPlayer, PlayerFeedback } from "@shared/schema";
import logoUrl from "@assets/logo_1772218489356.png";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export default function PlayerScreen() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<"NAME" | "WAITING" | "QUESTION" | "ANSWERED" | "FEEDBACK" | "KICKED" | "END" | "INVALID">("NAME");
  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [question, setQuestion] = useState<QuestionForPlayer | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PlayerFeedback | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const feedbackRef = useRef<PlayerFeedback | null>(null);
  const phaseRef = useRef(phase);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  phaseRef.current = phase;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get("s");
    if (!sId) {
      setPhase("INVALID");
      return;
    }
    setSessionId(sId);

    const savedPlayer = localStorage.getItem("fawazeer_playerId");
    const savedSession = localStorage.getItem("fawazeer_sessionId");
    if (savedPlayer && savedSession === sId) {
      const socket = getSocket();
      socket.emit("player:reconnect", { sessionId: sId, playerId: savedPlayer }, (res: any) => {
        if (res.success) {
          setPlayerId(savedPlayer);
          setPlayerName(res.playerName);
          setScore(res.score || 0);
          if (res.phase === "QUESTION") {
            setPhase("QUESTION");
            setQuestion(res.question);
            setTimeLeft(res.timeLeft || 0);
            setGameStarted(true);
          } else if (res.phase === "END") {
            setPhase("END");
          } else {
            setPhase("WAITING");
            setGameStarted(true);
          }
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionId || phase === "INVALID") return;

    const socket = getSocket();

    socket.on("game:questionStart", (data) => {
      setGameStarted(true);
      setQuestion(data.question);
      setPhase("QUESTION");
      setSelectedAnswer(null);
      setFeedback(null);
      feedbackRef.current = null;
      setTimeLeft(data.question.timeLimit);

      if (timerRef.current) clearInterval(timerRef.current);
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const remaining = Math.max(0, data.question.timeLimit - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0 && timerRef.current) clearInterval(timerRef.current);
      }, 100);
    });

    socket.on("game:questionEnd", () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(0);
      if (phaseRef.current === "QUESTION") setPhase("ANSWERED");
    });

    socket.on("game:reveal", () => {
      if (feedbackRef.current) {
        setPhase("FEEDBACK");
        if (feedbackRef.current.correct) {
          confetti({
            particleCount: 60,
            spread: 80,
            origin: { y: 0.6 },
            colors: ["#CDB58B", "#22c55e", "#e8d5a8"],
          });
        }
      }
    });

    socket.on("game:leaderboard", () => {
      setPhase("WAITING");
    });

    socket.on("game:end", () => {
      setPhase("END");
    });

    socket.on("game:kicked", () => {
      setPhase("KICKED");
      localStorage.removeItem("fawazeer_playerId");
      localStorage.removeItem("fawazeer_sessionId");
    });

    socket.on("game:paused", () => {
      if (timerRef.current) clearInterval(timerRef.current);
    });

    socket.on("game:resumed", (data) => {
      if (timerRef.current) clearInterval(timerRef.current);
      const remaining = data.timerDuration - (Date.now() - data.timerStartedAt) / 1000;
      setTimeLeft(Math.max(0, remaining));
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        setTimeLeft(Math.max(0, remaining - elapsed));
      }, 100);
    });

    socket.on("game:restarted", () => {
      setPhase("NAME");
      setScore(0);
      setGameStarted(false);
      setQuestion(null);
      setFeedback(null);
      feedbackRef.current = null;
      setSelectedAnswer(null);
      setPlayerId("");
      setPlayerName("");
      setName("");
      localStorage.removeItem("fawazeer_playerId");
      localStorage.removeItem("fawazeer_sessionId");
    });

    socket.on("game:doublePoints", () => {});

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      socket.off("game:questionStart");
      socket.off("game:questionEnd");
      socket.off("game:reveal");
      socket.off("game:leaderboard");
      socket.off("game:end");
      socket.off("game:kicked");
      socket.off("game:paused");
      socket.off("game:resumed");
      socket.off("game:restarted");
      socket.off("game:doublePoints");
    };
  }, [sessionId]);

  const handleJoin = () => {
    if (!name.trim()) {
      setError("الرجاء إدخال اسمك");
      return;
    }
    setError("");
    const socket = getSocket();
    socket.emit("player:join", { sessionId, name: name.trim() }, (res: any) => {
      if (res.success) {
        setPlayerId(res.playerId);
        setPlayerName(res.playerName);
        localStorage.setItem("fawazeer_playerId", res.playerId);
        localStorage.setItem("fawazeer_sessionId", res.sessionId);
        setPhase("WAITING");
      } else {
        setError(res.error || "تعذر الانضمام");
      }
    });
  };

  const handleAnswer = (answer: "A" | "B" | "C" | "D") => {
    if (selectedAnswer) return;
    setSelectedAnswer(answer);

    if (navigator.vibrate) navigator.vibrate(30);

    const socket = getSocket();
    socket.emit("player:answer", { sessionId, playerId, answer }, (res: any) => {
      if (res.success) {
        feedbackRef.current = res.feedback;
        setFeedback(res.feedback);
        setScore(res.feedback.totalScore);
      }
      setPhase("ANSWERED");
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" dir="rtl" data-testid="player-screen">
      <AnimatePresence mode="wait">
        {phase === "INVALID" && (
          <motion.div key="invalid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h1 className="text-2xl font-bold text-[#CDB58B] mb-4">رابط غير صالح</h1>
            <p className="text-muted-foreground text-center mb-6">امسح رمز QR من الشاشة الرئيسية للانضمام</p>
          </motion.div>
        )}

        {phase === "NAME" && (
          <motion.div key="name" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.img
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.5 }}
              src={logoUrl}
              alt="فوازير سيف"
              className="h-20 mb-6 object-contain opacity-90"
              data-testid="img-player-logo"
            />
            <motion.h1
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-3xl font-bold gold-shimmer mb-2"
            >
              فوازير سيف
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-muted-foreground mb-8"
            >
              أدخل اسمك للانضمام
            </motion.p>

            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className="w-full max-w-sm space-y-4"
            >
              <Input
                type="text"
                placeholder="اسمك"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-center text-lg h-14 bg-card border-border/50"
                maxLength={30}
                dir="auto"
                data-testid="input-name"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                autoFocus
              />
              {error && (
                <motion.p
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="text-red-400 text-sm text-center"
                  data-testid="text-error"
                >
                  {error}
                </motion.p>
              )}
              <Button onClick={handleJoin} className="w-full h-14 text-lg font-semibold" data-testid="button-join">
                انضم
              </Button>
            </motion.div>
          </motion.div>
        )}

        {phase === "WAITING" && (
          <motion.div key="waiting" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.img
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              src={logoUrl}
              alt="فوازير سيف"
              className="h-16 mb-6 object-contain opacity-80"
            />
            <div className="text-center">
              <div className="flex justify-center gap-2 mb-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -12, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    className="w-3 h-3 rounded-full bg-[#CDB58B]"
                  />
                ))}
              </div>
              <p className="text-muted-foreground text-lg">
                {gameStarted ? "بانتظار السؤال التالي..." : "بانتظار بدء اللعبة..."}
              </p>
              {gameStarted && (
                <motion.p
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring" }}
                  className="mt-4 text-sm text-[#CDB58B] font-semibold"
                  data-testid="text-score"
                >
                  النقاط: {score.toLocaleString()}
                </motion.p>
              )}
            </div>
          </motion.div>
        )}

        {phase === "QUESTION" && question && (
          <motion.div key="question" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">سؤال {question.index + 1}/{question.totalQuestions}</span>
              {question.isDoublePoints && (
                <motion.span
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="text-xs px-2 py-0.5 bg-[#CDB58B]/15 text-[#CDB58B] rounded-full font-semibold"
                >
                  x2
                </motion.span>
              )}
              <motion.span
                className={`text-xl font-bold tabular-nums ${timeLeft <= 5 ? "text-red-400" : "text-[#CDB58B]"}`}
                animate={timeLeft <= 5 && timeLeft > 0 ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 0.5, repeat: Infinity }}
                data-testid="text-player-timer"
              >
                {Math.ceil(timeLeft)}
              </motion.span>
            </div>

            <div className="mb-4 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${question.timeLimit > 0 ? (timeLeft / question.timeLimit) * 100 : 0}%`,
                  background: (timeLeft / question.timeLimit) > 0.3 ? "#CDB58B" : (timeLeft / question.timeLimit) > 0.1 ? "#d4a054" : "#c44",
                  transition: "width 0.3s linear",
                }}
              />
            </div>

            <motion.p
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring" }}
              className="text-lg font-semibold mb-6 text-center"
              dir="auto"
              data-testid="text-player-question"
            >
              {question.text}
            </motion.p>

            <div className="flex-1 grid grid-cols-1 gap-3">
              {OPTION_LABELS.map((label, i) => (
                <motion.button
                  key={label}
                  initial={{ x: 30, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.08, type: "spring", bounce: 0.3 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleAnswer(label)}
                  disabled={!!selectedAnswer}
                  className={`w-full py-5 px-5 rounded-xl border text-right flex items-center gap-4 transition-colors ${selectedAnswer === label ? "bg-[#CDB58B]/20 border-[#CDB58B]/50 text-foreground" : selectedAnswer ? "bg-card/40 border-border/20 text-muted-foreground opacity-50" : "bg-card border-border/30 text-foreground active:bg-[#CDB58B]/10"}`}
                  dir="auto"
                  data-testid={`button-answer-${label}`}
                >
                  <span className="flex-1 font-medium">{question.options[i]}</span>
                  {selectedAnswer === label && (
                    <motion.span
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", bounce: 0.6 }}
                      className="w-6 h-6 rounded-full bg-[#CDB58B] flex items-center justify-center shrink-0"
                    >
                      <svg className="w-4 h-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </motion.span>
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {phase === "ANSWERED" && (
          <motion.div key="answered" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.5 }}
              className="w-20 h-20 rounded-full bg-[#CDB58B]/20 flex items-center justify-center mb-4"
            >
              <motion.svg
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="w-10 h-10 text-[#CDB58B]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </motion.svg>
            </motion.div>
            <motion.h3
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-xl font-semibold"
            >
              تم استلام الإجابة
            </motion.h3>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-muted-foreground mt-2"
            >
              بانتظار النتائج...
            </motion.p>
          </motion.div>
        )}

        {phase === "FEEDBACK" && feedback && (
          <motion.div key="feedback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.5, duration: 0.6 }}
              className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${feedback.correct ? "bg-green-500/20" : "bg-red-500/20"}`}
            >
              {feedback.correct ? (
                <svg className="w-14 h-14 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <motion.svg
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 0.4 }}
                  className="w-14 h-14 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </motion.svg>
              )}
            </motion.div>

            <motion.h3
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className={`text-2xl font-bold mb-2 ${feedback.correct ? "text-green-400" : "text-red-400"}`}
            >
              {feedback.correct ? "إجابة صحيحة!" : "إجابة خاطئة!"}
            </motion.h3>

            {feedback.pointsGained > 0 && (
              <motion.p
                initial={{ y: 30, opacity: 0, scale: 0.5 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
                className="text-3xl font-bold text-[#CDB58B] mb-1"
                dir="ltr"
              >
                +{feedback.pointsGained.toLocaleString()}
              </motion.p>
            )}

            {feedback.streakBonus && (
              <motion.p
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: [0, 1.2, 1], rotate: [0, 5, 0] }}
                transition={{ delay: 0.5, type: "spring" }}
                className="text-[#CDB58B] font-semibold mb-2"
              >
                مكافأة السلسلة! +500
              </motion.p>
            )}

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-4 space-y-2 text-center"
            >
              <p className="text-muted-foreground">المجموع: <span className="text-foreground font-bold" dir="ltr">{feedback.totalScore.toLocaleString()}</span></p>
              <p className="text-muted-foreground">الترتيب: <span className="text-foreground font-bold">#{feedback.rank}</span></p>
              {feedback.streak >= 2 && (
                <motion.p
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="text-[#CDB58B] text-sm"
                >
                  🔥 {feedback.streak} إجابات صحيحة متتالية
                </motion.p>
              )}
            </motion.div>
          </motion.div>
        )}

        {phase === "KICKED" && (
          <motion.div key="kicked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.h3
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring" }}
              className="text-2xl font-bold text-red-400 mb-2"
            >
              تم إخراجك من اللعبة
            </motion.h3>
            <p className="text-muted-foreground">تم إخراجك من قبل المضيف</p>
          </motion.div>
        )}

        {phase === "END" && (
          <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.h3
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", bounce: 0.4 }}
              className="text-2xl font-bold text-[#CDB58B] mb-4"
            >
              انتهت اللعبة!
            </motion.h3>
            <motion.p
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
              className="text-4xl font-bold text-[#CDB58B] mb-2"
              dir="ltr"
              data-testid="text-final-score"
            >
              {score.toLocaleString()}
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-muted-foreground"
            >
              مجموع النقاط
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
