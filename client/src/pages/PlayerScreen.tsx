import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QuestionForPlayer, PlayerFeedback } from "@shared/schema";
import logoUrl from "@assets/logo_1772218489356.png";

const OPTION_COLORS: Record<string, string> = {
  A: "from-red-500 to-red-600 active:from-red-600 active:to-red-700",
  B: "from-blue-500 to-blue-600 active:from-blue-600 active:to-blue-700",
  C: "from-emerald-500 to-emerald-600 active:from-emerald-600 active:to-emerald-700",
  D: "from-amber-500 to-amber-600 active:from-amber-600 active:to-amber-700",
};
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
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get("s");

    if (!sId) {
      setPhase("INVALID");
      return;
    }
    setSessionId(sId);

    const savedPlayerId = localStorage.getItem("fawazeer_playerId");
    const savedSessionId = localStorage.getItem("fawazeer_sessionId");

    if (savedPlayerId && savedSessionId && savedSessionId === sId) {
      const socket = getSocket();
      socket.emit("player:reconnect", { sessionId: savedSessionId, playerId: savedPlayerId }, (res: any) => {
        if (res.success) {
          setPlayerId(res.playerId);
          setPlayerName(res.playerName);
          setScore(res.score || 0);

          if (res.phase === "LOBBY") {
            setPhase("WAITING");
            setGameStarted(false);
          } else if (res.phase === "END") {
            setPhase("END");
            setGameStarted(true);
          } else if (res.phase === "QUESTION" && res.question && !res.alreadyAnswered) {
            setGameStarted(true);
            setQuestion(res.question);
            setPhase("QUESTION");
            const elapsed = (Date.now() - res.timerStartedAt) / 1000;
            const remaining = Math.max(0, res.timerDuration - elapsed);
            setTimeLeft(remaining);
            if (timerRef.current) clearInterval(timerRef.current);
            const start = Date.now();
            timerRef.current = setInterval(() => {
              const e = (Date.now() - start) / 1000;
              const r = Math.max(0, remaining - e);
              setTimeLeft(r);
              if (r <= 0 && timerRef.current) clearInterval(timerRef.current);
            }, 100);
          } else if (res.phase === "QUESTION" && res.alreadyAnswered) {
            setGameStarted(true);
            setPhase("ANSWERED");
          } else {
            setGameStarted(true);
            setPhase("WAITING");
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
      if (phase === "QUESTION") setPhase("ANSWERED");
    });

    socket.on("game:reveal", () => {});

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
      setPhase("WAITING");
      setScore(0);
      setGameStarted(false);
      setQuestion(null);
      setFeedback(null);
      setSelectedAnswer(null);
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
  }, [sessionId, phase]);

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

    const socket = getSocket();
    socket.emit("player:answer", { sessionId, playerId, answer }, (res: any) => {
      if (res.success) {
        setFeedback(res.feedback);
        setScore(res.feedback.totalScore);
        setPhase("FEEDBACK");
      } else {
        setPhase("ANSWERED");
      }
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
          <motion.div key="name" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <img src={logoUrl} alt="فوازير سيف" className="h-20 mb-6 object-contain opacity-90" data-testid="img-player-logo" />
            <h1 className="text-3xl font-bold text-[#CDB58B] mb-2">فوازير سيف</h1>
            <p className="text-muted-foreground mb-8">أدخل اسمك للانضمام</p>

            <div className="w-full max-w-sm space-y-4">
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
              {error && <p className="text-red-400 text-sm text-center" data-testid="text-error">{error}</p>}
              <Button onClick={handleJoin} className="w-full h-14 text-lg font-semibold" data-testid="button-join">
                انضم
              </Button>
            </div>
          </motion.div>
        )}

        {phase === "WAITING" && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="text-center">
              <img src={logoUrl} alt="فوازير سيف" className="h-14 mx-auto mb-4 object-contain opacity-80" />
              <p className="text-lg text-muted-foreground mb-2">مرحباً</p>
              <h2 className="text-3xl font-bold text-[#CDB58B] mb-6" dir="auto">{playerName}</h2>
              <div className="w-16 h-16 mx-auto border-4 border-[#CDB58B]/30 border-t-[#CDB58B] rounded-full animate-spin" />
              <p className="mt-6 text-muted-foreground text-lg">
                {gameStarted ? "بانتظار السؤال التالي..." : "بانتظار بدء اللعبة..."}
              </p>
              {gameStarted && (
                <p className="mt-2 text-sm text-[#CDB58B] font-semibold" data-testid="text-score">النقاط: {score.toLocaleString()}</p>
              )}
            </div>
          </motion.div>
        )}

        {phase === "QUESTION" && question && (
          <motion.div key="question" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">سؤال {question.index + 1}/{question.totalQuestions}</span>
              {question.isDoublePoints && <span className="text-xs px-2 py-0.5 bg-[#CDB58B]/15 text-[#CDB58B] rounded-full font-semibold">x2</span>}
              <span className="text-xl font-bold text-[#CDB58B] tabular-nums" data-testid="text-player-timer">{Math.ceil(timeLeft)}</span>
            </div>

            <div className="mb-4 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-[#CDB58B] rounded-full transition-all duration-100" style={{ width: `${question.timeLimit > 0 ? (timeLeft / question.timeLimit) * 100 : 0}%` }} />
            </div>

            <p className="text-lg font-semibold mb-6 text-center" dir="auto" data-testid="text-player-question">{question.text}</p>

            <div className="flex-1 grid grid-cols-1 gap-3" dir="ltr">
              {OPTION_LABELS.map((label, i) => (
                <motion.button
                  key={label}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => handleAnswer(label)}
                  disabled={!!selectedAnswer}
                  className={`w-full py-5 px-6 rounded-xl bg-gradient-to-r ${OPTION_COLORS[label]} text-white font-bold text-lg text-right flex items-center gap-4 transition-transform active:scale-[0.97] disabled:opacity-50`}
                  dir="auto"
                  data-testid={`button-answer-${label}`}
                >
                  <span className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold shrink-0">{label}</span>
                  <span className="flex-1">{question.options[i]}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {phase === "ANSWERED" && (
          <motion.div key="answered" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 rounded-full bg-[#CDB58B]/20 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-[#CDB58B]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </motion.div>
            <h3 className="text-xl font-semibold">تم استلام الإجابة</h3>
            <p className="text-muted-foreground mt-2">بانتظار النتائج...</p>
          </motion.div>
        )}

        {phase === "FEEDBACK" && feedback && (
          <motion.div key="feedback" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${feedback.correct ? "bg-green-500/20" : "bg-red-500/20"}`}
            >
              {feedback.correct ? (
                <svg className="w-14 h-14 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-14 h-14 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              )}
            </motion.div>

            <h3 className={`text-2xl font-bold mb-2 ${feedback.correct ? "text-green-400" : "text-red-400"}`}>
              {feedback.correct ? "إجابة صحيحة!" : "إجابة خاطئة!"}
            </h3>

            {feedback.pointsGained > 0 && (
              <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-3xl font-bold text-[#CDB58B] mb-1" dir="ltr">
                +{feedback.pointsGained.toLocaleString()}
              </motion.p>
            )}

            {feedback.streakBonus && (
              <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-[#CDB58B] font-semibold mb-2">
                مكافأة السلسلة! +500
              </motion.p>
            )}

            <div className="mt-4 space-y-2 text-center">
              <p className="text-muted-foreground">المجموع: <span className="text-foreground font-bold" dir="ltr">{feedback.totalScore.toLocaleString()}</span></p>
              <p className="text-muted-foreground">الترتيب: <span className="text-foreground font-bold">#{feedback.rank}</span></p>
              {feedback.streak >= 2 && <p className="text-[#CDB58B] text-sm">{feedback.streak} إجابات صحيحة متتالية</p>}
            </div>
          </motion.div>
        )}

        {phase === "KICKED" && (
          <motion.div key="kicked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h3 className="text-2xl font-bold text-red-400 mb-2">تم إخراجك من اللعبة</h3>
            <p className="text-muted-foreground">تم إخراجك من قبل المضيف</p>
          </motion.div>
        )}

        {phase === "END" && (
          <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h3 className="text-2xl font-bold text-[#CDB58B] mb-4">انتهت اللعبة!</h3>
            <p className="text-4xl font-bold text-[#CDB58B] mb-2" dir="ltr" data-testid="text-final-score">{score.toLocaleString()}</p>
            <p className="text-muted-foreground">مجموع النقاط</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
