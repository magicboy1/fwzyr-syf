import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import confetti from "canvas-confetti";
import type { QuestionForPlayer, PlayerFeedback } from "@shared/schema";
import { REGIONS } from "@shared/schema";
import { BRAND } from "@/brand";
import { valueByCategory } from "@/lib/values";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export default function PlayerScreen() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<"NAME" | "WAITING" | "QUESTION" | "ANSWERED" | "FEEDBACK" | "KICKED" | "END" | "INVALID">("NAME");
  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState("");
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [question, setQuestion] = useState<QuestionForPlayer | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PlayerFeedback | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);
  const feedbackRef = useRef<PlayerFeedback | null>(null);
  const phaseRef = useRef(phase);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
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
            setQuestion(res.question);
            setTimeLeft(res.timeLeft || 0);
            setGameStarted(true);
            // if they already answered this question, show the waiting state
            // instead of the answer buttons (a duplicate would be rejected anyway)
            setPhase(res.alreadyAnswered ? "ANSWERED" : "QUESTION");
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
      setSelectedAnswer(null);
      setFeedback(null);
      feedbackRef.current = null;
      setTimeLeft(data.question.timeLimit);

      if (countdownRef.current) clearInterval(countdownRef.current);
      if (timerRef.current) clearInterval(timerRef.current);

      const CD_STEPS = 3;
      const CD_INTERVAL = 600;
      const CD_TOTAL = CD_STEPS * CD_INTERVAL;

      setShowCountdown(true);
      setCountdownNum(CD_STEPS);
      let count = CD_STEPS;
      countdownRef.current = setInterval(() => {
        count--;
        if (count > 0) {
          setCountdownNum(count);
        } else {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          setShowCountdown(false);
          setPhase("QUESTION");
        }
      }, CD_INTERVAL);

      const start = Date.now() + CD_TOTAL;
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
            colors: [BRAND.colors.gold, "#22c55e", BRAND.colors.goldLight],
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

    // After the socket reconnects (e.g. server redeploy/restart) re-join the
    // game automatically so the player doesn't have to refresh their phone.
    const onReconnect = () => {
      const pid = localStorage.getItem("fawazeer_playerId");
      if (!pid) return;
      socket.emit("player:reconnect", { sessionId, playerId: pid }, (res: any) => {
        if (!res?.success) return;
        setScore(res.score || 0);
        if (res.phase === "QUESTION") {
          setQuestion(res.question);
          setTimeLeft(res.timeLeft || 0);
          setGameStarted(true);
          setPhase(res.alreadyAnswered ? "ANSWERED" : "QUESTION");
        } else if (res.phase === "END") {
          setPhase("END");
        } else {
          setPhase("WAITING");
          setGameStarted(true);
        }
      });
    };
    socket.io.on("reconnect", onReconnect);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      socket.io.off("reconnect", onReconnect);
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
    const trimmed = name.trim();
    const parts = trimmed.split(/\s+/);
    if (!trimmed) {
      setError("Please enter your name");
      return;
    }
    if (parts.length < 2) {
      setError("Please enter your first and last name");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email");
      return;
    }
    if (!region) {
      setError("Please select your region");
      return;
    }
    setError("");
    const socket = getSocket();
    socket.emit("player:join", { sessionId, name: trimmed, email: email.trim(), region }, (res: any) => {
      if (res.success) {
        setPlayerId(res.playerId);
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

  // While answering a value's question, tint the phone with that value's colour
  // The phone keeps a calm, fixed dark canvas everywhere so contrast is constant
  // (white text on dark). Only the registration screen shows the brand gradient.
  // Each value is expressed as an accent — the value-name pill, the timer and the
  // progress bar — not the whole background.
  const value = valueByCategory(question?.category);
  const accent = value?.color;
  const accentText = value && value.onColor === "dark" ? "#15233a" : "#ffffff";

  return (
    <div
      className={`min-h-screen text-foreground flex flex-col ${phase === "NAME" ? "" : "bg-background"}`}
      dir="ltr"
      data-testid="player-screen"
    >
      <AnimatePresence>
        {showCountdown && (
          <motion.div
            key="player-countdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={countdownNum}
                initial={{ scale: 3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.3, opacity: 0 }}
                transition={{ duration: 0.4, ease: "backOut" }}
                className="text-8xl font-black text-gold drop-shadow-[0_0_40px_rgba(205,181,139,0.5)]"
              >
                {countdownNum}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase === "INVALID" && (
          <motion.div key="invalid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <h1 className="text-2xl font-bold text-gold mb-4">Invalid link</h1>
            <p className="text-muted-foreground text-center mb-6">Scan the QR code on the main screen to join</p>
          </motion.div>
        )}

        {phase === "NAME" && (
          <motion.div key="name" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.img
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.5 }}
              src={BRAND.logo}
              alt={BRAND.name}
              className="h-24 mb-6 object-contain"
              data-testid="img-player-logo"
            />
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-muted-foreground mb-8"
            >
              Enter your details to join
            </motion.p>

            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className="w-full max-w-sm space-y-4"
            >
              <Input
                type="text"
                placeholder="First and last name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-center text-lg h-14 bg-card border-border/50"
                maxLength={60}
                dir="auto"
                data-testid="input-name"
                autoFocus
              />
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="text-center text-lg h-14 bg-card border-border/50"
                maxLength={120}
                dir="ltr"
                autoCapitalize="off"
                autoCorrect="off"
                data-testid="input-email"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center">Select your region</p>
                <div className="grid grid-cols-3 gap-2">
                  {REGIONS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRegion(r.key)}
                      data-testid={`button-region-${r.key}`}
                      className={`h-14 rounded-xl border text-base font-semibold transition-colors ${
                        region === r.key
                          ? "bg-gold text-white border-gold"
                          : "bg-card text-foreground border-border/50 hover:border-gold/60"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
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
                Join
              </Button>
            </motion.div>
          </motion.div>
        )}

        {phase === "WAITING" && (
          <motion.div key="waiting" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.img
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              src={BRAND.logo}
              alt={BRAND.name}
              className="h-16 mb-6 object-contain opacity-80"
            />
            <div className="text-center">
              <div className="flex justify-center gap-2 mb-6">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -12, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    className="w-3 h-3 rounded-full bg-gold"
                  />
                ))}
              </div>
              <p className="text-muted-foreground text-lg">
                {gameStarted ? "Waiting for the next question..." : "Waiting for the game to start..."}
              </p>
              {gameStarted && (
                <motion.p
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring" }}
                  className="mt-4 text-sm text-gold font-semibold"
                  data-testid="text-score"
                >
                  Score: {score.toLocaleString()}
                </motion.p>
              )}
            </div>
          </motion.div>
        )}

        {phase === "QUESTION" && question && (
          <motion.div key="question" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col p-4">
            {value && (
              <div className="flex justify-center mb-3">
                <span
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-center"
                  style={{ background: accent, color: accentText }}
                  data-testid="player-value-pill"
                >
                  {value.key}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Question {question.index + 1}/{question.totalQuestions}</span>
              {question.isDoublePoints && (
                <motion.span
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="text-xs px-2 py-0.5 bg-gold/15 text-gold rounded-full font-semibold"
                >
                  x2
                </motion.span>
              )}
              <motion.span
                className={`text-xl font-bold tabular-nums ${timeLeft <= 5 ? "text-red-400" : "text-gold"}`}
                style={accent && timeLeft > 5 ? { color: accent } : undefined}
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
                  background: accent || ((timeLeft / question.timeLimit) > 0.3 ? BRAND.colors.gold : (timeLeft / question.timeLimit) > 0.1 ? BRAND.colors.goldAccent : "#c44"),
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
                  className={`w-full py-5 px-5 rounded-xl border text-left flex items-center gap-4 transition-colors ${selectedAnswer === label ? "bg-gold/20 border-gold/50 text-foreground" : selectedAnswer ? "bg-card/40 border-border/20 text-muted-foreground opacity-50" : "bg-card border-border/30 text-foreground active:bg-gold/10"}`}
                  dir="auto"
                  data-testid={`button-answer-${label}`}
                >
                  <span className="flex-1 font-medium">{question.options[i]}</span>
                  {selectedAnswer === label && (
                    <motion.span
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", bounce: 0.6 }}
                      className="w-6 h-6 rounded-full bg-gold flex items-center justify-center shrink-0"
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
              className="w-20 h-20 rounded-full bg-gold/20 flex items-center justify-center mb-4"
            >
              <motion.svg
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="w-10 h-10 text-gold"
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
              Answer received
            </motion.h3>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-muted-foreground mt-2"
            >
              Waiting for results...
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
              {feedback.correct ? "Correct!" : "Wrong!"}
            </motion.h3>

            {feedback.pointsGained > 0 && (
              <motion.p
                initial={{ y: 30, opacity: 0, scale: 0.5 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
                className="text-3xl font-bold text-gold mb-1"
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
                className="text-gold font-semibold mb-2"
              >
                Streak bonus!
              </motion.p>
            )}

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-4 space-y-2 text-center"
            >
              <p className="text-muted-foreground">Total: <span className="text-foreground font-bold" dir="ltr">{feedback.totalScore.toLocaleString()}</span></p>
              <p className="text-muted-foreground">Rank: <span className="text-foreground font-bold">#{feedback.rank}</span></p>
              {feedback.streak >= 2 && (
                <motion.p
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="text-gold text-sm"
                >
                  🔥 {feedback.streak} correct in a row
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
              You've been removed
            </motion.h3>
            <p className="text-muted-foreground">You were removed by the host</p>
          </motion.div>
        )}

        {phase === "END" && (
          <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-6">
            <motion.h3
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", bounce: 0.4 }}
              className="text-2xl font-bold text-gold mb-4"
            >
              Game Over!
            </motion.h3>
            <motion.p
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
              className="text-4xl font-bold text-gold mb-2"
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
              Total score
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
