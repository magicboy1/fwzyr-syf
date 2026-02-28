import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import logoUrl from "@assets/logo_1772218489356.png";
import type { QuestionForBigScreen, QuestionReveal, LeaderboardEntry, FinalStats } from "@shared/schema";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export default function DisplayScreen() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<string>("CONNECTING");
  const [sessionId, setSessionId] = useState("");
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [question, setQuestion] = useState<QuestionForBigScreen | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerDuration, setTimerDuration] = useState(0);
  const [reveal, setReveal] = useState<QuestionReveal | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<FinalStats | null>(null);
  const [showDoublePoints, setShowDoublePoints] = useState(false);
  const [paused, setPaused] = useState(false);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownNum, setCountdownNum] = useState(3);
  const [contextData, setContextData] = useState<{ context: string; index: number; totalQuestions: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const prevAnsweredRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get("s");
    if (!sId) {
      setPhase("ERROR");
      return;
    }
    setSessionId(sId);

    const socket = getSocket();
    socket.emit("display:join", { sessionId: sId }, (res: any) => {
      if (res.success) {
        setPhase(res.phase || "LOBBY");
        setPlayerCount(res.playerCount || 0);
        setPlayers(res.players || []);
      } else {
        setPhase("ERROR");
      }
    });

    socket.on("game:playerJoined", (data) => {
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
    });
    socket.on("game:playerLeft", (data) => {
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
    });

    socket.on("game:doublePoints", () => {
      setShowDoublePoints(true);
      setTimeout(() => setShowDoublePoints(false), 3000);
    });

    socket.on("game:answerUpdate", (data) => {
      setAnsweredCount(data.answeredCount);
      setTotalPlayers(data.totalPlayers);
    });

    socket.on("game:context", (data) => {
      setContextData({ context: data.context, index: data.index, totalQuestions: data.totalQuestions });
      setPhase("CONTEXT");
    });

    socket.on("game:questionStart", (data) => {
      setQuestion(data.question);
      setTimerDuration(data.question.timeLimit);
      setTimeLeft(data.question.timeLimit);
      setPaused(false);
      setStreakAlert(null);
      setAnsweredCount(0);
      setTotalPlayers(data.totalPlayers || 0);
      prevAnsweredRef.current = 0;

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
        if (remaining <= 0 && timerRef.current) {
          clearInterval(timerRef.current);
        }
      }, 50);
    });

    socket.on("game:questionEnd", () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(0);
    });

    socket.on("game:reveal", (data) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setReveal(data.reveal);
      setContextData(null);
      setPhase("REVEAL");
    });

    socket.on("game:leaderboard", (data) => {
      setLeaderboard(data.leaderboard);
      setPhase("LEADERBOARD");
    });

    socket.on("game:end", (data) => {
      setStats(data.stats);
      setPhase("END");
      setTimeout(() => {
        const duration = 4000;
        const end = Date.now() + duration;
        const frame = () => {
          confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: ["#CDB58B", "#e8d5a8", "#a89160"] });
          confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: ["#CDB58B", "#e8d5a8", "#a89160"] });
          if (Date.now() < end) requestAnimationFrame(frame);
        };
        frame();
      }, 500);
    });


    socket.on("game:paused", () => {
      setPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    });

    socket.on("game:resumed", (data) => {
      setPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
      const remaining = data.timerDuration - (Date.now() - data.timerStartedAt) / 1000;
      setTimeLeft(Math.max(0, remaining));
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const r = Math.max(0, remaining - elapsed);
        setTimeLeft(r);
        if (r <= 0 && timerRef.current) clearInterval(timerRef.current);
      }, 50);
    });

    socket.on("game:restarted", () => {
      setPhase("LOBBY");
      setPlayerCount(0);
      setPlayers([]);
      setQuestion(null);
      setReveal(null);
      setLeaderboard([]);
      setStats(null);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      socket.off("game:playerJoined");
      socket.off("game:playerLeft");
      socket.off("game:doublePoints");
      socket.off("game:answerUpdate");
      socket.off("game:context");
      socket.off("game:questionStart");
      socket.off("game:questionEnd");
      socket.off("game:reveal");
      socket.off("game:leaderboard");
      socket.off("game:end");
      socket.off("game:paused");
      socket.off("game:resumed");
      socket.off("game:restarted");
    };
  }, []);

  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/join?s=${sessionId}`
    : "";

  const timerPercent = timerDuration > 0 ? (timeLeft / timerDuration) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden" dir="rtl" data-testid="display-screen">
      <AnimatePresence mode="wait">
        {showDoublePoints && (
          <motion.div
            key="double"
            initial={{ opacity: 0, scale: 0.3, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          >
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="text-8xl font-bold text-[#CDB58B] drop-shadow-[0_0_30px_rgba(205,181,139,0.5)]"
              >
                x2
              </motion.div>
              <motion.p
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-3xl text-[#CDB58B] mt-6 font-semibold"
              >
                سؤال النقاط المضاعفة!
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCountdown && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={countdownNum}
                initial={{ scale: 3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.3, opacity: 0 }}
                transition={{ duration: 0.4, ease: "backOut" }}
                className="text-9xl font-black text-[#CDB58B] drop-shadow-[0_0_60px_rgba(205,181,139,0.6)]"
              >
                {countdownNum}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>


      {phase === "CONNECTING" && (
        <div className="flex items-center justify-center min-h-screen">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-12 h-12 border-4 border-[#CDB58B]/30 border-t-[#CDB58B] rounded-full" />
        </div>
      )}

      {phase === "ERROR" && (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <h2 className="text-3xl font-bold text-[#CDB58B] mb-4">الجلسة غير موجودة</h2>
          <p className="text-muted-foreground">أنشئ جلسة جديدة من لوحة المضيف</p>
        </div>
      )}

      {phase === "LOBBY" && <LobbyScreen sessionId={sessionId} joinUrl={joinUrl} playerCount={playerCount} players={players} />}
      {phase === "CONTEXT" && contextData && <ContextScreen context={contextData.context} index={contextData.index} totalQuestions={contextData.totalQuestions} />}
      {phase === "QUESTION" && question && (
        <QuestionScreen question={question} timeLeft={timeLeft} timerPercent={timerPercent} paused={paused} answeredCount={answeredCount} totalPlayers={totalPlayers} contextText={contextData?.context} />
      )}
      {phase === "REVEAL" && reveal && <RevealScreen reveal={reveal} question={question} />}
      {phase === "LEADERBOARD" && <LeaderboardScreen leaderboard={leaderboard} />}
      {phase === "END" && stats && <EndScreen stats={stats} />}
    </div>
  );
}

function ContextScreen({ context, index, totalQuestions }: { context: string; index: number; totalQuestions: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 6000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(100, (elapsed / duration) * 100));
      if (elapsed >= duration) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-16"
      data-testid="context-screen"
    >
      <motion.span
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-muted-foreground text-lg mb-4"
      >
        سؤال {index + 1} من {totalQuestions}
      </motion.span>

      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-[#CDB58B] text-sm font-semibold tracking-wide mb-6 uppercase"
      >
        📖 اقرأ المقدمة
      </motion.span>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.4, duration: 0.7, type: "spring", bounce: 0.2 }}
        className="bg-card/60 border border-[#CDB58B]/20 rounded-2xl px-10 py-8 lg:px-16 lg:py-12 max-w-4xl"
      >
        <p
          className="text-3xl lg:text-5xl text-foreground text-center leading-relaxed font-bold"
          dir="auto"
          data-testid="text-context"
        >
          {context}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-10 w-64"
      >
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[#CDB58B]/60 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">السؤال قادم...</p>
      </motion.div>
    </motion.div>
  );
}

function LobbyScreen({ sessionId, joinUrl, playerCount, players }: { sessionId: string; joinUrl: string; playerCount: number; players: { id: string; name: string }[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center p-8" data-testid="lobby-screen">
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.4 }}
        className="mb-8"
      >
        <img src={logoUrl} alt="السحور السنوي" className="h-20 mx-auto object-contain opacity-90" data-testid="img-logo" />
      </motion.div>

      <motion.h1
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.3, delay: 0.1 }}
        className="text-5xl font-bold gold-shimmer mb-2"
      >
        فوازير سيف
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-xl text-muted-foreground mb-12"
      >
        امسح الرمز للانضمام
      </motion.p>

      <div className="flex flex-col items-center">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", bounce: 0.4, delay: 0.2 }}
          whileHover={{ scale: 1.05 }}
          className="bg-white p-8 rounded-3xl shadow-2xl shadow-[#CDB58B]/10 mb-10"
          data-testid="qr-code"
        >
          <QRCodeSVG value={joinUrl} size={280} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
        </motion.div>

        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="bg-card/80 backdrop-blur rounded-2xl px-10 py-6 border border-[#CDB58B]/20"
        >
          <motion.p
            key={playerCount}
            initial={{ scale: 1.5, color: "#e8d5a8" }}
            animate={{ scale: 1, color: "#CDB58B" }}
            className="text-6xl font-bold text-[#CDB58B]"
            data-testid="text-player-count"
          >
            {playerCount}
          </motion.p>
          <p className="text-lg text-muted-foreground mt-1">لاعب انضموا</p>
        </motion.div>
      </div>

      {players.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 flex flex-wrap gap-3 justify-center max-w-3xl">
          {players.slice(-20).map((p, i) => (
            <motion.span
              key={p.id}
              initial={{ opacity: 0, scale: 0, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", bounce: 0.5, delay: i * 0.05 }}
              className="px-4 py-2 bg-card rounded-full border border-border/50 text-sm font-medium"
              data-testid={`text-player-${p.id}`}
            >
              {p.name}
            </motion.span>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function QuestionScreen({ question, timeLeft, timerPercent, paused, answeredCount, totalPlayers, contextText }: { question: QuestionForBigScreen; timeLeft: number; timerPercent: number; paused: boolean; answeredCount: number; totalPlayers: number; contextText?: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" data-testid="question-screen">
      <div className="flex items-center justify-between mb-6 gap-4">
        <motion.span
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="text-muted-foreground text-lg"
        >
          سؤال {question.index + 1} من {question.totalQuestions}
        </motion.span>
        {question.isDoublePoints && (
          <motion.span
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] text-sm font-semibold"
          >
            x2 نقاط مضاعفة
          </motion.span>
        )}
        <div className="flex items-center gap-6">
          <motion.span
            key={answeredCount}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            className="text-muted-foreground text-lg"
            data-testid="text-answered-count"
            dir="ltr"
          >
            {answeredCount}/{totalPlayers}
          </motion.span>
          {paused && <span className="text-[#CDB58B] font-semibold">متوقف</span>}
          <motion.span
            className={`text-3xl font-bold tabular-nums ${timeLeft <= 5 ? "text-red-400" : "text-[#CDB58B]"}`}
            animate={timeLeft <= 5 && timeLeft > 0 ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 0.5, repeat: Infinity }}
            data-testid="text-timer"
          >
            {Math.ceil(timeLeft)}
          </motion.span>
        </div>
      </div>

      <div className="w-full h-3 bg-muted rounded-full overflow-hidden mb-10">
        <motion.div
          className="h-full rounded-full"
          style={{
            width: `${timerPercent}%`,
            background: timerPercent > 30 ? "linear-gradient(90deg, #CDB58B, #e8d5a8)" : timerPercent > 10 ? "linear-gradient(90deg, #d4a054, #CDB58B)" : "linear-gradient(90deg, #c44, #d4a054)",
          }}
          transition={{ duration: 0.1 }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        {contextText && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-base lg:text-lg text-muted-foreground/70 text-center mb-4 max-w-3xl italic"
            dir="auto"
            data-testid="text-context-ref"
          >
            📖 {contextText}
          </motion.p>
        )}
        <motion.h2
          initial={{ y: 40, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
          className="text-4xl lg:text-6xl font-bold text-center leading-relaxed max-w-4xl"
          dir="auto"
          data-testid="text-question"
        >
          {question.text}
        </motion.h2>
      </div>
    </motion.div>
  );
}

function RevealScreen({ reveal, question }: { reveal: QuestionReveal; question: QuestionForBigScreen | null; }) {
  const streakMap = new Map<string, number>();
  if (reveal.streakPlayers) {
    for (const s of reveal.streakPlayers) {
      streakMap.set(s.playerName, s.streak);
    }
  }
  useEffect(() => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.5 },
      colors: ["#CDB58B", "#22c55e", "#e8d5a8"],
    });
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" data-testid="reveal-screen">
      <div className="mb-6">
        <p className="text-muted-foreground text-lg mb-1">سؤال {reveal.questionIndex + 1}</p>
        {question && <h2 className="text-2xl font-bold" dir="auto">{question.text}</h2>}
      </div>

      {reveal.isDoublePoints && (
        <div className="text-center mb-4">
          <span className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] text-sm font-semibold">x2 نقاط مضاعفة</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-10">
        {OPTION_LABELS.map((label, i) => {
          const isCorrect = label === reveal.correct;
          const optionText = reveal.options?.[i] || label;
          return (
            <motion.div
              key={label}
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{
                scale: isCorrect ? 1.05 : 1,
                opacity: 1,
                y: 0,
              }}
              transition={{ delay: i * 0.15, type: "spring", bounce: 0.4 }}
              className={`h-24 rounded-2xl flex items-center gap-4 px-6 relative border-2 ${isCorrect ? "bg-green-500/15 border-green-400 shadow-lg shadow-green-400/10" : "bg-card/30 border-border/20 opacity-40"}`}
              data-testid={`reveal-option-${label}`}
            >
              {isCorrect && (
                <motion.span
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.6, type: "spring", bounce: 0.5 }}
                  className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0"
                >
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </motion.span>
              )}
              <span className={`text-xl font-semibold flex-1 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="auto">{optionText}</span>
              <motion.span
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="text-lg font-bold tabular-nums text-muted-foreground"
                dir="ltr"
              >
                {reveal.percentages[label]}%
              </motion.span>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        {reveal.topFastest.length > 0 && (
          <motion.div
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="bg-card/50 rounded-2xl p-6 border border-border/30"
          >
            <h3 className="text-lg font-semibold text-[#CDB58B] mb-4">الأسرع إجابة</h3>
            {reveal.topFastest.map((p, i) => (
              <motion.div key={i} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.7 + i * 0.2, type: "spring" }} className="flex items-center gap-4 mb-3">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.8 + i * 0.2, type: "spring", bounce: 0.6 }}
                  className="w-8 h-8 rounded-full bg-[#CDB58B]/20 flex items-center justify-center font-bold text-[#CDB58B] text-sm"
                >
                  {i + 1}
                </motion.span>
                <span className="font-medium flex-1" dir="auto">{p.name}</span>
                <span className="text-muted-foreground" dir="ltr">{(p.timeMs / 1000).toFixed(1)}ث</span>
              </motion.div>
            ))}
          </motion.div>
        )}

        <motion.div
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="bg-card/50 rounded-2xl p-6 border border-border/30"
        >
          <h3 className="text-lg font-semibold text-[#CDB58B] mb-4">أفضل ٥</h3>
          {reveal.leaderboard.slice(0, 5).map((entry, i) => {
            const streak = streakMap.get(entry.name);
            return (
            <motion.div key={entry.playerId} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.7 + i * 0.15, type: "spring" }} className="flex items-center gap-4 mb-3">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-500 text-white" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}>{entry.rank}</span>
              <span className="font-medium flex-1 flex items-center gap-2" dir="auto">
                {entry.name}
                {streak && streak >= 3 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 1.2 + i * 0.1, type: "spring", bounce: 0.6 }}
                    className="px-2 py-0.5 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-full text-xs font-bold text-orange-400"
                  >
                    🔥 {streak}x
                  </motion.span>
                )}
              </span>
              {entry.previousRank !== null && entry.previousRank !== entry.rank && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 1 + i * 0.1, type: "spring" }}
                  className={`text-sm ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}
                >
                  {entry.rank < entry.previousRank ? `+${entry.previousRank - entry.rank}` : `-${entry.rank - entry.previousRank}`}
                </motion.span>
              )}
              <span className="font-bold text-[#CDB58B] tabular-nums" dir="ltr">{entry.score.toLocaleString()}</span>
            </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

function LeaderboardScreen({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-12" data-testid="leaderboard-screen">
      <motion.h2
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.4 }}
        className="text-4xl font-bold text-[#CDB58B] mb-12"
      >
        لوحة المتصدرين
      </motion.h2>
      <div className="w-full max-w-2xl">
        {leaderboard.slice(0, 10).map((entry, i) => (
          <motion.div
            key={entry.playerId}
            initial={{ x: i % 2 === 0 ? -80 : 80, opacity: 0, scale: 0.9 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.12, type: "spring", bounce: 0.3 }}
            className={`flex items-center gap-6 mb-4 p-4 rounded-xl ${i < 3 ? "bg-[#CDB58B]/10 border border-[#CDB58B]/20" : "bg-card/50 border border-border/20"}`}
            data-testid={`leaderboard-entry-${i}`}
          >
            <motion.span
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: i * 0.12 + 0.2, type: "spring", bounce: 0.5 }}
              className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white shadow-lg shadow-[#CDB58B]/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}
            >
              {entry.rank}
            </motion.span>
            <span className="text-xl font-semibold flex-1" dir="auto">{entry.name}</span>
            {entry.previousRank !== null && entry.previousRank !== entry.rank && (
              <motion.span
                initial={{ y: entry.rank < entry.previousRank ? 20 : -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.12 + 0.3, type: "spring" }}
                className={`text-sm font-medium ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}
              >
                {entry.rank < entry.previousRank ? `▲${entry.previousRank - entry.rank}` : `▼${entry.rank - entry.previousRank}`}
              </motion.span>
            )}
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.12 + 0.3, type: "spring" }}
              className="text-2xl font-bold text-[#CDB58B] tabular-nums"
              dir="ltr"
            >
              {entry.score.toLocaleString()}
            </motion.span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function EndScreen({ stats }: { stats: FinalStats }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col items-center p-8 lg:p-12 overflow-y-auto" data-testid="end-screen">
      <motion.img
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 0.8 }}
        transition={{ type: "spring", bounce: 0.4 }}
        src={logoUrl}
        alt="الشعار"
        className="h-12 mb-6"
      />
      <motion.h2
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.5 }}
        className="text-4xl font-bold text-[#CDB58B] mb-4"
      >
        انتهت اللعبة!
      </motion.h2>

      {stats.podium.length > 0 && (
        <div className="flex items-end justify-center gap-6 mb-12 mt-8">
          {stats.podium.length > 1 && (
            <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8, type: "spring", bounce: 0.4 }} className="flex flex-col items-center">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: 1 }}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-2xl font-bold text-gray-800 mb-3 shadow-lg"
              >
                2
              </motion.div>
              <p className="font-semibold text-lg mb-1" dir="auto">{stats.podium[1].name}</p>
              <p className="text-[#CDB58B] font-bold" dir="ltr">{stats.podium[1].score.toLocaleString()}</p>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 96 }}
                transition={{ delay: 0.8, duration: 0.5 }}
                className="w-24 bg-gradient-to-t from-gray-500/20 to-gray-400/10 rounded-t-lg mt-3"
              />
            </motion.div>
          )}

          <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, type: "spring", bounce: 0.4 }} className="flex flex-col items-center -mb-4">
            <motion.div
              animate={{ scale: [1, 1.08, 1], rotate: [0, 2, -2, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-28 h-28 rounded-full bg-gradient-to-br from-[#CDB58B] via-[#e8d5a8] to-[#a89160] flex items-center justify-center text-4xl font-bold text-white mb-3 shadow-2xl shadow-[#CDB58B]/40"
            >
              1
            </motion.div>
            <p className="font-bold text-2xl mb-1" dir="auto">{stats.podium[0].name}</p>
            <motion.p
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.7, type: "spring" }}
              className="text-[#CDB58B] font-bold text-xl"
              dir="ltr"
            >
              {stats.podium[0].score.toLocaleString()}
            </motion.p>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 128 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="w-28 bg-gradient-to-t from-[#CDB58B]/20 to-[#CDB58B]/5 rounded-t-lg mt-3"
            />
          </motion.div>

          {stats.podium.length > 2 && (
            <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.1, type: "spring", bounce: 0.4 }} className="flex flex-col items-center">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: 1.5 }}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-2xl font-bold text-white mb-3 shadow-lg"
              >
                3
              </motion.div>
              <p className="font-semibold text-lg mb-1" dir="auto">{stats.podium[2].name}</p>
              <p className="text-[#CDB58B] font-bold" dir="ltr">{stats.podium[2].score.toLocaleString()}</p>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 64 }}
                transition={{ delay: 1.1, duration: 0.4 }}
                className="w-24 bg-gradient-to-t from-orange-500/20 to-orange-400/10 rounded-t-lg mt-3"
              />
            </motion.div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl mb-8">
        {stats.fastestCorrect && (
          <StatCard title="أسرع إجابة صحيحة" value={`${(stats.fastestCorrect.timeMs / 1000).toFixed(1)} ثانية`} subtitle={stats.fastestCorrect.playerName} delay={0.3} />
        )}
        {stats.bestStreak && (
          <StatCard title="أفضل سلسلة" value={`${stats.bestStreak.streakLength} متتالية`} subtitle={stats.bestStreak.playerName} delay={0.4} />
        )}
        {stats.hardestQuestion && (
          <StatCard title="أصعب سؤال" value={`${stats.hardestQuestion.correctPercent}% صحيح`} subtitle={`سؤال ${stats.hardestQuestion.questionIndex + 1}`} delay={0.5} />
        )}
        <StatCard title="متوسط وقت الإجابة" value={`${(stats.avgResponseTime / 1000).toFixed(1)} ثانية`} subtitle="جميع اللاعبين" delay={0.6} />
        <StatCard title="نسبة المشاركة" value={`${stats.participationRate}%`} subtitle={`${stats.totalPlayers} لاعب`} delay={0.7} />
        <StatCard title="عدد الأسئلة" value={`${stats.totalQuestions}`} subtitle="سؤال تم لعبه" delay={0.8} />
      </div>
    </motion.div>
  );
}

function StatCard({ title, value, subtitle, delay = 0 }: { title: string; value: string; subtitle: string; delay?: number }) {
  return (
    <motion.div
      initial={{ y: 30, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", bounce: 0.3 }}
      whileHover={{ scale: 1.03 }}
      className="bg-card/60 rounded-xl p-5 border border-border/30 text-center"
    >
      <p className="text-sm text-muted-foreground mb-2">{title}</p>
      <motion.p
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.2, type: "spring", bounce: 0.5 }}
        className="text-2xl font-bold text-[#CDB58B]"
      >
        {value}
      </motion.p>
      <p className="text-sm text-muted-foreground mt-1" dir="auto">{subtitle}</p>
    </motion.div>
  );
}
