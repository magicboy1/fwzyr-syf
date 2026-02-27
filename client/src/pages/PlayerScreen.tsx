import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QuestionForPlayer, PlayerFeedback } from "@shared/schema";

const OPTION_COLORS: Record<string, string> = {
  A: "from-red-500 to-red-600 active:from-red-600 active:to-red-700",
  B: "from-blue-500 to-blue-600 active:from-blue-600 active:to-blue-700",
  C: "from-emerald-500 to-emerald-600 active:from-emerald-600 active:to-emerald-700",
  D: "from-amber-500 to-amber-600 active:from-amber-600 active:to-amber-700",
};
const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export default function PlayerScreen() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<"JOIN" | "WAITING" | "QUESTION" | "ANSWERED" | "FEEDBACK" | "KICKED" | "END">("JOIN");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [question, setQuestion] = useState<QuestionForPlayer | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PlayerFeedback | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPin = params.get("pin");
    if (urlPin) setPin(urlPin);

    const savedPlayerId = localStorage.getItem("fawazeer_playerId");
    const savedSessionId = localStorage.getItem("fawazeer_sessionId");

    if (savedPlayerId && savedSessionId) {
      const socket = getSocket();
      socket.emit("player:reconnect", { sessionId: savedSessionId, playerId: savedPlayerId }, (res: any) => {
        if (res.success) {
          setPlayerId(res.playerId);
          setSessionId(savedSessionId);
          setPlayerName(res.playerName);
          setScore(res.score || 0);

          if (res.phase === "LOBBY") {
            setPhase("WAITING");
          } else if (res.phase === "END") {
            setPhase("END");
          } else if (res.phase === "QUESTION" && res.question && !res.alreadyAnswered) {
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
            setPhase("ANSWERED");
          } else {
            setPhase("WAITING");
          }
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const socket = getSocket();

    socket.on("game:questionStart", (data) => {
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

    socket.on("game:reveal", (data) => {
      if (timerRef.current) clearInterval(timerRef.current);
      const myAnswer = data.reveal.questionIndex;
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
      setPhase("WAITING");
      setScore(0);
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
    if (!pin.trim() || !name.trim()) {
      setError("Please enter both PIN and name");
      return;
    }
    setError("");
    const socket = getSocket();
    socket.emit("player:join", { pin: pin.trim(), name: name.trim() }, (res: any) => {
      if (res.success) {
        setPlayerId(res.playerId);
        setSessionId(res.sessionId);
        setPlayerName(res.playerName);
        localStorage.setItem("fawazeer_playerId", res.playerId);
        localStorage.setItem("fawazeer_sessionId", res.sessionId);
        setPhase("WAITING");
      } else {
        setError(res.error || "Could not join");
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
    <div className="min-h-screen bg-background text-foreground flex flex-col" data-testid="player-screen">
      <AnimatePresence mode="wait">
        {phase === "JOIN" && (
          <motion.div key="join" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent mb-2">فوازير سيف</h1>
            <p className="text-muted-foreground mb-8">Join the quiz</p>

            <div className="w-full max-w-sm space-y-4">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Game PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="text-center text-2xl h-14 bg-card border-border/50 tracking-widest"
                maxLength={6}
                data-testid="input-pin"
              />
              <Input
                type="text"
                placeholder="Your Name / اسمك"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-center text-lg h-14 bg-card border-border/50"
                maxLength={30}
                dir="auto"
                data-testid="input-name"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
              {error && <p className="text-red-400 text-sm text-center" data-testid="text-error">{error}</p>}
              <Button onClick={handleJoin} className="w-full h-14 text-lg font-semibold" data-testid="button-join">
                Join / انضم
              </Button>
            </div>
          </motion.div>
        )}

        {phase === "WAITING" && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="text-center">
              <p className="text-lg text-muted-foreground mb-2">Welcome</p>
              <h2 className="text-3xl font-bold text-primary mb-4" dir="auto">{playerName}</h2>
              <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-16 h-16 mx-auto border-4 border-primary/30 border-t-primary rounded-full" style={{ animation: "spin 1s linear infinite" }} />
              <p className="mt-6 text-muted-foreground">Waiting for the next question...</p>
              <p className="mt-2 text-sm text-primary font-semibold" data-testid="text-score">Score: {score.toLocaleString()}</p>
            </div>
          </motion.div>
        )}

        {phase === "QUESTION" && question && (
          <motion.div key="question" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Q{question.index + 1}/{question.totalQuestions}</span>
              {question.isDoublePoints && <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full font-semibold">x2</span>}
              <span className="text-xl font-bold text-primary tabular-nums" data-testid="text-player-timer">{Math.ceil(timeLeft)}</span>
            </div>

            <div className="mb-4 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${question.timeLimit > 0 ? (timeLeft / question.timeLimit) * 100 : 0}%` }} />
            </div>

            <p className="text-lg font-semibold mb-6 text-center" dir="auto" data-testid="text-player-question">{question.text}</p>

            <div className="flex-1 grid grid-cols-1 gap-3">
              {OPTION_LABELS.map((label, i) => (
                <motion.button
                  key={label}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => handleAnswer(label)}
                  disabled={!!selectedAnswer}
                  className={`w-full py-5 px-6 rounded-xl bg-gradient-to-r ${OPTION_COLORS[label]} text-white font-bold text-lg text-left flex items-center gap-4 transition-transform active:scale-[0.97] disabled:opacity-50`}
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
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </motion.div>
            <h3 className="text-xl font-semibold">Answer Received</h3>
            <p className="text-muted-foreground mt-2">Waiting for results...</p>
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
              {feedback.correct ? "Correct!" : "Wrong!"}
            </h3>

            {feedback.pointsGained > 0 && (
              <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-3xl font-bold text-primary mb-1">
                +{feedback.pointsGained.toLocaleString()}
              </motion.p>
            )}

            {feedback.streakBonus && (
              <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-amber-400 font-semibold mb-2">
                Streak Bonus! +500
              </motion.p>
            )}

            <div className="mt-4 space-y-2 text-center">
              <p className="text-muted-foreground">Total Score: <span className="text-foreground font-bold">{feedback.totalScore.toLocaleString()}</span></p>
              <p className="text-muted-foreground">Rank: <span className="text-foreground font-bold">#{feedback.rank}</span></p>
              {feedback.streak >= 2 && <p className="text-amber-300 text-sm">Streak: {feedback.streak} correct in a row</p>}
            </div>
          </motion.div>
        )}

        {phase === "KICKED" && (
          <motion.div key="kicked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h3 className="text-2xl font-bold text-red-400 mb-2">Removed from game</h3>
            <p className="text-muted-foreground">You have been removed by the host.</p>
          </motion.div>
        )}

        {phase === "END" && (
          <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h3 className="text-2xl font-bold bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent mb-4">Game Over!</h3>
            <p className="text-4xl font-bold text-primary mb-2" data-testid="text-final-score">{score.toLocaleString()}</p>
            <p className="text-muted-foreground">Final Score</p>
            <Button
              onClick={() => {
                localStorage.removeItem("fawazeer_playerId");
                localStorage.removeItem("fawazeer_sessionId");
                setPhase("JOIN");
                setPin("");
                setName("");
                setScore(0);
              }}
              variant="secondary"
              className="mt-8"
              data-testid="button-play-again"
            >
              Play Again
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
