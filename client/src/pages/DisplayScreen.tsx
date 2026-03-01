import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import { Maximize, Minimize } from "lucide-react";
import logoUrl from "@assets/logo_1772218489356.png";
import type { QuestionForBigScreen, QuestionReveal, LeaderboardEntry, FinalStats } from "@shared/schema";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;
const OPTION_COLORS = [
  { bg: "bg-red-500/15", border: "border-red-400/40", text: "text-red-400", fill: "#ef4444" },
  { bg: "bg-blue-500/15", border: "border-blue-400/40", text: "text-blue-400", fill: "#3b82f6" },
  { bg: "bg-yellow-500/15", border: "border-yellow-400/40", text: "text-yellow-400", fill: "#eab308" },
  { bg: "bg-green-500/15", border: "border-green-400/40", text: "text-green-400", fill: "#22c55e" },
] as const;

function useIsPortrait() {
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false
  );
  useEffect(() => {
    const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isPortrait;
}

const pFade = { initial: { opacity: 0, scale: 0.97 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.97 } };

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const prevAnsweredRef = useRef(0);
  const isPortrait = useIsPortrait();

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

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
      setPlayers(data.players || []);
    });

    socket.on("game:playerLeft", (data) => {
      setPlayerCount(data.playerCount);
    });

    socket.on("game:answerUpdate", (data) => {
      setAnsweredCount(data.answeredCount);
      setTotalPlayers(data.totalPlayers);
    });

    socket.on("game:context", (data) => {
      setPhase("CONTEXT");
      setContextData(data);
      setReveal(null);
      setQuestion(null);
    });

    socket.on("game:questionStart", (data) => {
      setQuestion(data.question);
      setTimerDuration(data.question.timeLimit);
      setTimeLeft(data.question.timeLimit);
      setPaused(false);
      setAnsweredCount(0);
      setTotalPlayers(data.totalPlayers || 0);
      prevAnsweredRef.current = 0;

      if (countdownRef.current) clearInterval(countdownRef.current);

      if (data.question.isDoublePoints) {
        setShowDoublePoints(true);
        setTimeout(() => {
          setShowDoublePoints(false);
          setPhase("QUESTION");
          startTimer(data.question.timeLimit);
        }, 2500);
      } else {
        setShowCountdown(true);
        setCountdownNum(3);
        let count = 3;
        countdownRef.current = setInterval(() => {
          count--;
          if (count <= 0) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            setShowCountdown(false);
            setPhase("QUESTION");
            startTimer(data.question.timeLimit);
          } else {
            setCountdownNum(count);
          }
        }, 700);
      }
    });

    function startTimer(duration: number) {
      if (timerRef.current) clearInterval(timerRef.current);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(0, duration - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0 && timerRef.current) clearInterval(timerRef.current);
      }, 100);
    }

    socket.on("game:questionEnd", () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(0);
    });

    socket.on("game:reveal", (data) => {
      setPhase("REVEAL");
      setReveal(data.reveal);
      setContextData(null);

      const frame = () => {
        confetti({ particleCount: 3, angle: 60 + Math.random() * 60, spread: 55, origin: { x: Math.random(), y: 0.6 }, colors: ["#CDB58B", "#22c55e", "#e8d5a8"], disableForReducedMotion: true });
      };
      let count = 0;
      const interval = setInterval(() => {
        frame();
        count++;
        if (count > 20) clearInterval(interval);
      }, 500);
    });

    socket.on("game:paused", () => {
      setPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    });

    socket.on("game:resumed", (data) => {
      setPaused(false);
      if (data?.timeLeft > 0) {
        setTimeLeft(data.timeLeft);
        if (timerRef.current) clearInterval(timerRef.current);
        const startTime = Date.now();
        timerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const remaining = Math.max(0, data.timeLeft - elapsed);
          setTimeLeft(remaining);
          if (remaining <= 0 && timerRef.current) clearInterval(timerRef.current);
        }, 100);
      }
    });

    socket.on("game:leaderboard", (data) => {
      setPhase("LEADERBOARD");
      setLeaderboard(data.leaderboard);
    });

    socket.on("game:end", (data) => {
      setPhase("END");
      setStats(data.stats);
    });

    socket.on("game:restarted", () => {
      setPhase("LOBBY");
      setQuestion(null);
      setReveal(null);
      setLeaderboard([]);
      setStats(null);
      setTimeLeft(0);
      setContextData(null);
      setAnsweredCount(0);
      setTotalPlayers(0);
    });

    socket.on("game:doublePoints", () => {
      setShowDoublePoints(true);
      setTimeout(() => setShowDoublePoints(false), 2500);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      socket.off("game:playerJoined");
      socket.off("game:playerLeft");
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
      <button
        onClick={toggleFullscreen}
        className="fixed top-4 left-4 z-[60] p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
        data-testid="button-fullscreen"
        title={isFullscreen ? "خروج من ملء الشاشة" : "ملء الشاشة"}
      >
        {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
      </button>

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

      {phase === "LOBBY" && <LobbyScreen sessionId={sessionId} joinUrl={joinUrl} playerCount={playerCount} isPortrait={isPortrait} />}
      {phase === "CONTEXT" && contextData && <ContextScreen context={contextData.context} index={contextData.index} totalQuestions={contextData.totalQuestions} isPortrait={isPortrait} />}
      {phase === "QUESTION" && question && (
        <QuestionScreen question={question} timeLeft={timeLeft} timerPercent={timerPercent} paused={paused} answeredCount={answeredCount} totalPlayers={totalPlayers} contextText={contextData?.context} isPortrait={isPortrait} />
      )}
      {phase === "REVEAL" && reveal && <RevealScreen reveal={reveal} question={question} isPortrait={isPortrait} />}
      {phase === "LEADERBOARD" && <LeaderboardScreen leaderboard={leaderboard} isPortrait={isPortrait} />}
      {phase === "END" && stats && <EndScreen stats={stats} isPortrait={isPortrait} />}
    </div>
  );
}

function ContextScreen({ context, index, totalQuestions, isPortrait }: { context: string; index: number; totalQuestions: number; isPortrait: boolean }) {
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

  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center justify-center" style={{ padding: "5%" }} data-testid="context-screen">
        <div style={{ maxWidth: "80%" }} className="flex flex-col items-center text-center">
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="ds-secondary text-muted-foreground mb-3">
            سؤال {index + 1} من {totalQuestions}
          </motion.span>
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="text-[#CDB58B] ds-small font-semibold tracking-wide mb-6">
            📖 اقرأ المقدمة
          </motion.span>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.7 }}
            className="bg-card/60 border border-[#CDB58B]/20 rounded-2xl px-8 py-8 w-full"
          >
            <p className="ds-question text-foreground text-center leading-relaxed font-bold" dir="auto" data-testid="text-context">
              {context}
            </p>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-8 w-48">
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#CDB58B]/60 transition-all duration-100" style={{ width: `${progress}%` }} />
            </div>
            <p className="ds-small text-muted-foreground text-center mt-2">السؤال قادم...</p>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-16"
      data-testid="context-screen"
    >
      <motion.span initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-muted-foreground ds-secondary mb-4">
        سؤال {index + 1} من {totalQuestions}
      </motion.span>
      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="text-[#CDB58B] ds-small font-semibold tracking-wide mb-6">
        📖 اقرأ المقدمة
      </motion.span>
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.4, duration: 0.7, type: "spring", bounce: 0.2 }}
        className="bg-card/60 border border-[#CDB58B]/20 rounded-2xl" style={{ maxWidth: "80%", padding: "clamp(32px, 3vw, 72px)" }}
      >
        <p className="ds-question text-foreground text-center leading-relaxed font-bold" dir="auto" data-testid="text-context">
          {context}
        </p>
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-10" style={{ width: "clamp(200px, 15vw, 400px)" }}>
        <div className="w-full bg-muted rounded-full overflow-hidden" style={{ height: "clamp(6px, 0.3vw, 12px)" }}>
          <div className="h-full rounded-full bg-[#CDB58B]/60 transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <p className="ds-small text-muted-foreground text-center mt-2">السؤال قادم...</p>
      </motion.div>
    </motion.div>
  );
}

function LobbyScreen({ sessionId, joinUrl, playerCount, isPortrait }: { sessionId: string; joinUrl: string; playerCount: number; isPortrait: boolean }) {
  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center justify-center" style={{ padding: "5%" }} data-testid="lobby-screen">
        <div style={{ maxWidth: "80%" }} className="flex flex-col items-center text-center w-full">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} className="mb-6">
            <img src={logoUrl} alt="السحور السنوي" className="h-16 mx-auto object-contain opacity-90" data-testid="img-logo" />
          </motion.div>
          <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="ds-question font-bold gold-shimmer mb-2">
            فوازير سيف
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="ds-secondary text-muted-foreground mb-8">
            امسح الرمز للانضمام
          </motion.p>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-white p-6 rounded-3xl shadow-2xl shadow-[#CDB58B]/10 mb-8"
            data-testid="qr-code"
          >
            <QRCodeSVG value={joinUrl} size={220} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
          </motion.div>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="bg-card/80 backdrop-blur rounded-2xl px-10 py-5 border border-[#CDB58B]/20"
          >
            <motion.p key={playerCount} initial={{ scale: 1.5, color: "#e8d5a8" }} animate={{ scale: 1, color: "#CDB58B" }} className="text-5xl font-bold text-[#CDB58B]" data-testid="text-player-count">
              {playerCount}
            </motion.p>
            <p className="ds-small text-muted-foreground mt-1">لاعب انضموا</p>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex items-center justify-center" style={{ padding: "clamp(24px, 3vw, 64px)" }} data-testid="lobby-screen">
      <div className="flex items-center justify-center w-full gap-[5vw]">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", bounce: 0.4, delay: 0.2 }}
          className="bg-white rounded-3xl shadow-2xl shadow-[#CDB58B]/20 flex-shrink-0"
          style={{ padding: "clamp(24px, 2.5vw, 56px)" }}
          data-testid="qr-code"
        >
          <QRCodeSVG value={joinUrl} size={Math.min(Math.max(Math.round(window.innerHeight * 0.55), 280), 700)} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
        </motion.div>

        <div className="flex flex-col items-center text-center">
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.4 }} className="mb-6">
            <img src={logoUrl} alt="السحور السنوي" className="mx-auto object-contain opacity-90" style={{ height: "clamp(64px, 8vh, 160px)" }} data-testid="img-logo" />
          </motion.div>
          <motion.h1 initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.3, delay: 0.1 }} className="ds-question font-bold gold-shimmer mb-3">
            فوازير سيف
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="ds-secondary text-muted-foreground mb-10">
            امسح الرمز للانضمام
          </motion.p>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="bg-card/80 backdrop-blur rounded-2xl border border-[#CDB58B]/20"
            style={{ padding: "clamp(16px, 2vw, 48px) clamp(32px, 4vw, 80px)" }}
          >
            <motion.p key={playerCount} initial={{ scale: 1.5, color: "#e8d5a8" }} animate={{ scale: 1, color: "#CDB58B" }} className="font-bold text-[#CDB58B]" style={{ fontSize: "clamp(48px, 8vw, 180px)" }} data-testid="text-player-count">
              {playerCount}
            </motion.p>
            <p className="ds-secondary text-muted-foreground mt-1">لاعب انضموا</p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function CircularTimer({ timeLeft, timerDuration, size = 120 }: { timeLeft: number; timerDuration: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = timerDuration > 0 ? timeLeft / timerDuration : 0;
  const offset = circumference * (1 - progress);
  const isLow = timeLeft <= 5;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={isLow ? "#ef4444" : "#CDB58B"}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-100"
        />
      </svg>
      <motion.span
        className={`absolute font-bold tabular-nums ${isLow ? "text-red-400" : "text-[#CDB58B]"}`}
        style={{ fontSize: size * 0.3 }}
        animate={isLow && timeLeft > 0 ? { scale: [1, 1.15, 1] } : {}}
        transition={{ duration: 0.5, repeat: Infinity }}
        data-testid="text-timer"
      >
        {Math.ceil(timeLeft)}
      </motion.span>
    </div>
  );
}

function PortraitOptionBlock({ label, index }: { label: string; index: number }) {
  const shapes = [
    <svg viewBox="0 0 60 60" className="w-full h-full"><polygon points="30,5 55,55 5,55" fill={OPTION_COLORS[0].fill} opacity={0.25} /><polygon points="30,12 48,48 12,48" fill={OPTION_COLORS[0].fill} opacity={0.4} /></svg>,
    <svg viewBox="0 0 60 60" className="w-full h-full"><rect x="8" y="8" width="44" height="44" rx="4" fill={OPTION_COLORS[1].fill} opacity={0.25} /><rect x="14" y="14" width="32" height="32" rx="3" fill={OPTION_COLORS[1].fill} opacity={0.4} /></svg>,
    <svg viewBox="0 0 60 60" className="w-full h-full"><circle cx="30" cy="30" r="26" fill={OPTION_COLORS[2].fill} opacity={0.25} /><circle cx="30" cy="30" r="18" fill={OPTION_COLORS[2].fill} opacity={0.4} /></svg>,
    <svg viewBox="0 0 60 60" className="w-full h-full"><polygon points="30,2 58,30 30,58 2,30" fill={OPTION_COLORS[3].fill} opacity={0.25} /><polygon points="30,12 48,30 30,48 12,30" fill={OPTION_COLORS[3].fill} opacity={0.4} /></svg>,
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
      className={`relative rounded-2xl border-2 ${OPTION_COLORS[index].border} ${OPTION_COLORS[index].bg} flex items-center justify-center aspect-square`}
      data-testid={`option-block-${label}`}
    >
      <div className="absolute inset-0 flex items-center justify-center opacity-60 p-3">
        {shapes[index]}
      </div>
      <span className={`relative z-10 font-black ${OPTION_COLORS[index].text}`} style={{ fontSize: "clamp(32px, 6vw, 72px)" }}>
        {label}
      </span>
    </motion.div>
  );
}

function QuestionScreen({ question, timeLeft, timerPercent, paused, answeredCount, totalPlayers, contextText, isPortrait }: { question: QuestionForBigScreen; timeLeft: number; timerPercent: number; paused: boolean; answeredCount: number; totalPlayers: number; contextText?: string; isPortrait: boolean }) {
  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col" style={{ padding: "5%" }} data-testid="question-screen">
        <div style={{ maxWidth: "80%", margin: "0 auto" }} className="flex flex-col items-center flex-1 w-full">
          <div className="flex items-center justify-center gap-3 mb-3 w-full">
            <img src={logoUrl} alt="" className="h-8 object-contain opacity-70" />
            <span className="ds-small text-muted-foreground font-semibold">فوازير سيف</span>
          </div>

          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ds-secondary text-muted-foreground mb-2">
            سؤال {question.index + 1} من {question.totalQuestions}
          </motion.span>

          {question.isDoublePoints && (
            <motion.span animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1, repeat: Infinity }} className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] ds-small font-semibold mb-3">
              x2 نقاط مضاعفة
            </motion.span>
          )}

          {contextText && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ds-small text-muted-foreground/70 text-center mb-3 italic" dir="auto">
              📖 {contextText}
            </motion.p>
          )}

          <div className="flex-1 flex items-center justify-center w-full my-4">
            <motion.h2
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="ds-question font-bold text-center leading-relaxed"
              dir="auto"
              data-testid="text-question"
            >
              {question.text}
            </motion.h2>
          </div>

          <div className="my-6">
            <CircularTimer timeLeft={timeLeft} timerDuration={question.timeLimit} size={120} />
          </div>

          <div className="flex items-center justify-center gap-6 ds-small text-muted-foreground mt-auto">
            <span dir="ltr" data-testid="text-answered-count">{answeredCount}/{totalPlayers} أجابوا</span>
            {paused && <span className="text-[#CDB58B] font-semibold">متوقف</span>}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" data-testid="question-screen">
      <div className="flex items-center justify-between mb-6 gap-4">
        <motion.span initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="text-muted-foreground ds-secondary">
          سؤال {question.index + 1} من {question.totalQuestions}
        </motion.span>
        {question.isDoublePoints && (
          <motion.span animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1, repeat: Infinity }} className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] ds-small font-semibold">
            x2 نقاط مضاعفة
          </motion.span>
        )}
        <div className="flex items-center gap-6">
          <motion.span key={answeredCount} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-muted-foreground ds-secondary" data-testid="text-answered-count" dir="ltr">
            {answeredCount}/{totalPlayers}
          </motion.span>
          {paused && <span className="text-[#CDB58B] font-semibold ds-secondary">متوقف</span>}
          <motion.span
            className={`font-bold tabular-nums ds-question ${timeLeft <= 5 ? "text-red-400" : "text-[#CDB58B]"}`}
            animate={timeLeft <= 5 && timeLeft > 0 ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 0.5, repeat: Infinity }}
            data-testid="text-timer"
          >
            {Math.ceil(timeLeft)}
          </motion.span>
        </div>
      </div>
      <div className="w-full bg-muted rounded-full overflow-hidden mb-10" style={{ height: "clamp(12px, 0.5vw, 24px)" }}>
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
          <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="ds-secondary text-muted-foreground/70 text-center mb-4 italic" style={{ maxWidth: "80%" }} dir="auto" data-testid="text-context-ref">
            📖 {contextText}
          </motion.p>
        )}
        <motion.h2
          initial={{ y: 40, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
          className="ds-question font-bold text-center leading-relaxed"
          style={{ maxWidth: "85%" }}
          dir="auto"
          data-testid="text-question"
        >
          {question.text}
        </motion.h2>
      </div>
    </motion.div>
  );
}

function RevealScreen({ reveal, question, isPortrait }: { reveal: QuestionReveal; question: QuestionForBigScreen | null; isPortrait: boolean }) {
  useEffect(() => {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 }, colors: ["#CDB58B", "#22c55e", "#e8d5a8"] });
  }, []);

  const fastestSection = reveal.topFastest.length > 0 ? (
    <motion.div
      initial={isPortrait ? { opacity: 0, scale: 0.95 } : { x: -40, opacity: 0 }}
      animate={isPortrait ? { opacity: 1, scale: 1 } : { x: 0, opacity: 1 }}
      transition={{ delay: 0.5 }}
      className="bg-card/50 rounded-2xl p-6 border border-border/30 w-full"
    >
      <h3 className={`font-semibold text-[#CDB58B] mb-4 ${isPortrait ? "ds-secondary text-center" : "ds-secondary"}`}>⚡ الأسرع إجابة</h3>
      {reveal.topFastest.map((p, i) => (
        <motion.div
          key={i}
          initial={isPortrait ? { opacity: 0, scale: 0.95 } : { x: 30, opacity: 0 }}
          animate={isPortrait ? { opacity: 1, scale: 1 } : { x: 0, opacity: 1 }}
          transition={{ delay: 0.6 + i * 0.15, type: "spring" }}
          className="flex items-center gap-4 mb-3"
        >
          <span className={`rounded-full bg-[#CDB58B]/20 flex items-center justify-center font-bold text-[#CDB58B] ds-small`} style={{ width: isPortrait ? "clamp(32px, 4vw, 56px)" : "clamp(32px, 2.5vw, 56px)", height: isPortrait ? "clamp(32px, 4vw, 56px)" : "clamp(32px, 2.5vw, 56px)" }}>{i + 1}</span>
          <span className="font-medium flex-1 ds-small" dir="auto">{p.name}</span>
          <span className="text-muted-foreground ds-small" dir="ltr">{(p.timeMs / 1000).toFixed(1)}ث</span>
        </motion.div>
      ))}
    </motion.div>
  ) : null;

  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col overflow-y-auto" style={{ padding: "5%" }} data-testid="reveal-screen">
        <div style={{ maxWidth: "85%", margin: "0 auto" }} className="w-full flex flex-col items-center">
          <p className="ds-secondary text-muted-foreground mb-2">سؤال {reveal.questionIndex + 1}</p>
          {question && <h2 className="ds-question font-bold text-center mb-5" dir="auto">{question.text}</h2>}

          {reveal.isDoublePoints && (
            <div className="text-center mb-4">
              <span className="px-5 py-2 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] ds-secondary font-semibold">x2 نقاط مضاعفة</span>
            </div>
          )}

          <div className="w-full space-y-3 mb-6">
            {OPTION_LABELS.map((label, i) => {
              const isCorrect = label === reveal.correct;
              return (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: isCorrect ? 1.02 : 1 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className={`rounded-xl flex items-center gap-3 px-5 py-4 border-2 ${isCorrect ? "bg-green-500/15 border-green-400 shadow-lg shadow-green-400/10" : "bg-card/30 border-border/20 opacity-40"}`}
                  data-testid={`reveal-option-${label}`}
                >
                  {isCorrect && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring" }} className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </motion.span>
                  )}
                  <span className={`ds-secondary font-semibold flex-1 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="auto">{reveal.options?.[i] || label}</span>
                  <span className="ds-secondary font-bold tabular-nums text-muted-foreground" dir="ltr">{reveal.percentages[label]}%</span>
                </motion.div>
              );
            })}
          </div>

          {fastestSection}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" data-testid="reveal-screen">
      <div className="mb-6">
        <p className="text-muted-foreground ds-small mb-1">سؤال {reveal.questionIndex + 1}</p>
        {question && <h2 className="ds-secondary font-bold" dir="auto">{question.text}</h2>}
      </div>
      {reveal.isDoublePoints && (
        <div className="text-center mb-4">
          <span className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] ds-small font-semibold">x2 نقاط مضاعفة</span>
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
              animate={{ scale: isCorrect ? 1.05 : 1, opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15, type: "spring", bounce: 0.4 }}
              className={`rounded-2xl flex items-center gap-4 relative border-2 ${isCorrect ? "bg-green-500/15 border-green-400 shadow-lg shadow-green-400/10" : "bg-card/30 border-border/20 opacity-40"}`}
              style={{ padding: "clamp(16px, 1.5vw, 36px)" }}
              data-testid={`reveal-option-${label}`}
            >
              {isCorrect && (
                <motion.span initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.6, type: "spring", bounce: 0.5 }} className="rounded-full bg-green-500 flex items-center justify-center shrink-0" style={{ width: "clamp(32px, 2.5vw, 56px)", height: "clamp(32px, 2.5vw, 56px)" }}>
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </motion.span>
              )}
              <span className={`ds-secondary font-semibold flex-1 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="auto">{optionText}</span>
              <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.1 }} className="ds-secondary font-bold tabular-nums text-muted-foreground" dir="ltr">
                {reveal.percentages[label]}%
              </motion.span>
            </motion.div>
          );
        })}
      </div>
      <div className="flex-1">
        {fastestSection}
      </div>
    </motion.div>
  );
}

function LeaderboardScreen({ leaderboard, isPortrait }: { leaderboard: LeaderboardEntry[]; isPortrait: boolean }) {
  const items = isPortrait ? leaderboard.slice(0, 5) : leaderboard.slice(0, 10);

  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center justify-center" style={{ padding: "5%" }} data-testid="leaderboard-screen">
        <div style={{ maxWidth: "80%" }} className="w-full flex flex-col items-center">
          <motion.h2 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ds-question font-bold text-[#CDB58B] mb-8">
            لوحة المتصدرين
          </motion.h2>
          <div className="w-full space-y-3">
            {items.map((entry, i) => (
              <motion.div
                key={entry.playerId}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.12 }}
                className={`flex items-center gap-4 p-4 rounded-xl ${i < 3 ? "bg-[#CDB58B]/10 border border-[#CDB58B]/20" : "bg-card/50 border border-border/20"}`}
                data-testid={`leaderboard-entry-${i}`}
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.12 + 0.2, type: "spring", bounce: 0.5 }}
                  className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white shadow-lg shadow-[#CDB58B]/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}
                >
                  {entry.rank}
                </motion.span>
                <span className="ds-secondary font-semibold flex-1" dir="auto">{entry.name}</span>
                {entry.previousRank !== null && entry.previousRank !== entry.rank && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.12 + 0.3 }}
                    className={`text-sm font-medium ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}
                  >
                    {entry.rank < entry.previousRank ? `▲${entry.previousRank - entry.rank}` : `▼${entry.rank - entry.previousRank}`}
                  </motion.span>
                )}
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.12 + 0.3, type: "spring" }}
                  className="ds-secondary font-bold text-[#CDB58B] tabular-nums"
                  dir="ltr"
                >
                  {entry.score.toLocaleString()}
                </motion.span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-12" data-testid="leaderboard-screen">
      <motion.h2 initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.4 }} className="ds-question font-bold text-[#CDB58B] mb-12">
        لوحة المتصدرين
      </motion.h2>
      <div className="w-full" style={{ maxWidth: "70%" }}>
        {leaderboard.slice(0, 10).map((entry, i) => (
          <motion.div
            key={entry.playerId}
            initial={{ x: i % 2 === 0 ? -80 : 80, opacity: 0, scale: 0.9 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.12, type: "spring", bounce: 0.3 }}
            className={`flex items-center gap-6 mb-4 rounded-xl ${i < 3 ? "bg-[#CDB58B]/10 border border-[#CDB58B]/20" : "bg-card/50 border border-border/20"}`}
            style={{ padding: "clamp(12px, 1vw, 24px)" }}
            data-testid={`leaderboard-entry-${i}`}
          >
            <motion.span
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: i * 0.12 + 0.2, type: "spring", bounce: 0.5 }}
              className={`rounded-full flex items-center justify-center font-bold ds-secondary ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white shadow-lg shadow-[#CDB58B]/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}
              style={{ width: "clamp(40px, 3vw, 72px)", height: "clamp(40px, 3vw, 72px)" }}
            >
              {entry.rank}
            </motion.span>
            <span className="ds-secondary font-semibold flex-1" dir="auto">{entry.name}</span>
            {entry.previousRank !== null && entry.previousRank !== entry.rank && (
              <motion.span
                initial={{ y: entry.rank < entry.previousRank ? 20 : -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.12 + 0.3, type: "spring" }}
                className={`ds-small font-medium ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}
              >
                {entry.rank < entry.previousRank ? `▲${entry.previousRank - entry.rank}` : `▼${entry.rank - entry.previousRank}`}
              </motion.span>
            )}
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.12 + 0.3, type: "spring" }}
              className="ds-secondary font-bold text-[#CDB58B] tabular-nums"
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

function EndScreen({ stats, isPortrait }: { stats: FinalStats; isPortrait: boolean }) {
  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center overflow-y-auto" style={{ padding: "5%" }} data-testid="end-screen">
        <div style={{ maxWidth: "80%" }} className="w-full flex flex-col items-center">
          <motion.img initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} src={logoUrl} alt="الشعار" className="h-10 mb-4" />
          <motion.h2 initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="ds-question font-bold text-[#CDB58B] mb-6">
            انتهت اللعبة!
          </motion.h2>

          {stats.podium.length > 0 && (
            <div className="flex items-end justify-center gap-4 mb-8 w-full">
              {stats.podium.length > 1 && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 }} className="flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-xl font-bold text-gray-800 mb-2 shadow-lg">2</div>
                  <p className="font-semibold ds-small mb-1 text-center" dir="auto">{stats.podium[1].name}</p>
                  <p className="text-[#CDB58B] font-bold ds-small" dir="ltr">{stats.podium[1].score.toLocaleString()}</p>
                  <motion.div initial={{ height: 0 }} animate={{ height: 80 }} transition={{ delay: 0.8, duration: 0.5 }} className="w-24 bg-gradient-to-t from-gray-500/20 to-gray-400/10 rounded-t-lg mt-2" />
                </motion.div>
              )}
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="flex flex-col items-center">
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-24 h-24 rounded-full bg-gradient-to-br from-[#CDB58B] via-[#e8d5a8] to-[#a89160] flex items-center justify-center text-3xl font-bold text-white mb-2 shadow-2xl shadow-[#CDB58B]/40">
                  1
                </motion.div>
                <p className="font-bold ds-secondary mb-1 text-center" dir="auto">{stats.podium[0].name}</p>
                <p className="text-[#CDB58B] font-bold ds-secondary" dir="ltr">{stats.podium[0].score.toLocaleString()}</p>
                <motion.div initial={{ height: 0 }} animate={{ height: 120 }} transition={{ delay: 0.5, duration: 0.6 }} className="w-28 bg-gradient-to-t from-[#CDB58B]/20 to-[#CDB58B]/5 rounded-t-lg mt-2" />
              </motion.div>
              {stats.podium.length > 2 && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.1 }} className="flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-xl font-bold text-white mb-2 shadow-lg">3</div>
                  <p className="font-semibold ds-small mb-1 text-center" dir="auto">{stats.podium[2].name}</p>
                  <p className="text-[#CDB58B] font-bold ds-small" dir="ltr">{stats.podium[2].score.toLocaleString()}</p>
                  <motion.div initial={{ height: 0 }} animate={{ height: 56 }} transition={{ delay: 1.1, duration: 0.4 }} className="w-24 bg-gradient-to-t from-orange-500/20 to-orange-400/10 rounded-t-lg mt-2" />
                </motion.div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 w-full mb-6">
            {stats.fastestCorrect && <StatCard title="أسرع إجابة صحيحة" value={`${(stats.fastestCorrect.timeMs / 1000).toFixed(1)} ثانية`} subtitle={stats.fastestCorrect.playerName} delay={0.3} isPortrait />}
            {stats.bestStreak && <StatCard title="أفضل سلسلة" value={`${stats.bestStreak.streakLength} متتالية`} subtitle={stats.bestStreak.playerName} delay={0.4} isPortrait />}
            {stats.hardestQuestion && <StatCard title="أصعب سؤال" value={`${stats.hardestQuestion.correctPercent}% صحيح`} subtitle={`سؤال ${stats.hardestQuestion.questionIndex + 1}`} delay={0.5} isPortrait />}
            <StatCard title="متوسط وقت الإجابة" value={`${(stats.avgResponseTime / 1000).toFixed(1)} ثانية`} subtitle="جميع اللاعبين" delay={0.6} isPortrait />
            <StatCard title="نسبة المشاركة" value={`${stats.participationRate}%`} subtitle={`${stats.totalPlayers} لاعب`} delay={0.7} isPortrait />
            <StatCard title="عدد الأسئلة" value={`${stats.totalQuestions}`} subtitle="سؤال تم لعبه" delay={0.8} isPortrait />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col items-center p-8 lg:p-12 overflow-y-auto" data-testid="end-screen">
      <motion.img initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 0.8 }} transition={{ type: "spring", bounce: 0.4 }} src={logoUrl} alt="الشعار" style={{ height: "clamp(48px, 4vw, 96px)" }} className="mb-6" />
      <motion.h2 initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }} className="ds-question font-bold text-[#CDB58B] mb-4">
        انتهت اللعبة!
      </motion.h2>
      {stats.podium.length > 0 && (
        <div className="flex items-end justify-center mb-12 mt-8" style={{ gap: "clamp(24px, 3vw, 64px)" }}>
          {stats.podium.length > 1 && (
            <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8, type: "spring", bounce: 0.4 }} className="flex flex-col items-center">
              <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity, delay: 1 }} className="rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center font-bold text-gray-800 mb-3 shadow-lg ds-secondary" style={{ width: "clamp(64px, 5vw, 120px)", height: "clamp(64px, 5vw, 120px)" }}>
                2
              </motion.div>
              <p className="font-semibold ds-secondary mb-1" dir="auto">{stats.podium[1].name}</p>
              <p className="text-[#CDB58B] font-bold ds-small" dir="ltr">{stats.podium[1].score.toLocaleString()}</p>
              <motion.div initial={{ height: 0 }} animate={{ height: "clamp(80px, 8vw, 160px)" }} transition={{ delay: 0.8, duration: 0.5 }} className="bg-gradient-to-t from-gray-500/20 to-gray-400/10 rounded-t-lg mt-3" style={{ width: "clamp(96px, 7vw, 160px)" }} />
            </motion.div>
          )}
          <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, type: "spring", bounce: 0.4 }} className="flex flex-col items-center">
            <motion.div animate={{ scale: [1, 1.08, 1], rotate: [0, 2, -2, 0] }} transition={{ duration: 2, repeat: Infinity }} className="rounded-full bg-gradient-to-br from-[#CDB58B] via-[#e8d5a8] to-[#a89160] flex items-center justify-center font-bold text-white mb-3 shadow-2xl shadow-[#CDB58B]/40 ds-question" style={{ width: "clamp(96px, 7vw, 160px)", height: "clamp(96px, 7vw, 160px)" }}>
              1
            </motion.div>
            <p className="font-bold ds-secondary mb-1" dir="auto">{stats.podium[0].name}</p>
            <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.7, type: "spring" }} className="text-[#CDB58B] font-bold ds-secondary" dir="ltr">
              {stats.podium[0].score.toLocaleString()}
            </motion.p>
            <motion.div initial={{ height: 0 }} animate={{ height: "clamp(112px, 10vw, 220px)" }} transition={{ delay: 0.5, duration: 0.6 }} className="bg-gradient-to-t from-[#CDB58B]/20 to-[#CDB58B]/5 rounded-t-lg mt-3" style={{ width: "clamp(112px, 8vw, 180px)" }} />
          </motion.div>
          {stats.podium.length > 2 && (
            <motion.div initial={{ y: 150, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.1, type: "spring", bounce: 0.4 }} className="flex flex-col items-center">
              <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity, delay: 1.5 }} className="rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center font-bold text-white mb-3 shadow-lg ds-secondary" style={{ width: "clamp(64px, 5vw, 120px)", height: "clamp(64px, 5vw, 120px)" }}>
                3
              </motion.div>
              <p className="font-semibold ds-secondary mb-1" dir="auto">{stats.podium[2].name}</p>
              <p className="text-[#CDB58B] font-bold ds-small" dir="ltr">{stats.podium[2].score.toLocaleString()}</p>
              <motion.div initial={{ height: 0 }} animate={{ height: "clamp(56px, 5vw, 110px)" }} transition={{ delay: 1.1, duration: 0.4 }} className="bg-gradient-to-t from-orange-500/20 to-orange-400/10 rounded-t-lg mt-3" style={{ width: "clamp(96px, 7vw, 160px)" }} />
            </motion.div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 w-full mb-8" style={{ maxWidth: "70%" }}>
        {stats.fastestCorrect && <StatCard title="أسرع إجابة صحيحة" value={`${(stats.fastestCorrect.timeMs / 1000).toFixed(1)} ثانية`} subtitle={stats.fastestCorrect.playerName} delay={0.3} />}
        {stats.bestStreak && <StatCard title="أفضل سلسلة" value={`${stats.bestStreak.streakLength} متتالية`} subtitle={stats.bestStreak.playerName} delay={0.4} />}
        {stats.hardestQuestion && <StatCard title="أصعب سؤال" value={`${stats.hardestQuestion.correctPercent}% صحيح`} subtitle={`سؤال ${stats.hardestQuestion.questionIndex + 1}`} delay={0.5} />}
        <StatCard title="متوسط وقت الإجابة" value={`${(stats.avgResponseTime / 1000).toFixed(1)} ثانية`} subtitle="جميع اللاعبين" delay={0.6} />
        <StatCard title="نسبة المشاركة" value={`${stats.participationRate}%`} subtitle={`${stats.totalPlayers} لاعب`} delay={0.7} />
        <StatCard title="عدد الأسئلة" value={`${stats.totalQuestions}`} subtitle="سؤال تم لعبه" delay={0.8} />
      </div>
    </motion.div>
  );
}

function StatCard({ title, value, subtitle, delay = 0, isPortrait = false }: { title: string; value: string; subtitle: string; delay?: number; isPortrait?: boolean }) {
  return (
    <motion.div
      initial={isPortrait ? { opacity: 0, scale: 0.95 } : { y: 30, opacity: 0, scale: 0.9 }}
      animate={isPortrait ? { opacity: 1, scale: 1 } : { y: 0, opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", bounce: 0.3 }}
      className="bg-card/60 rounded-xl p-4 border border-border/30 text-center"
    >
      <p className="text-muted-foreground mb-1 ds-small">{title}</p>
      <motion.p
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.2, type: "spring", bounce: 0.5 }}
        className="font-bold text-[#CDB58B] ds-secondary"
      >
        {value}
      </motion.p>
      <p className="text-muted-foreground mt-1 ds-small" dir="auto">{subtitle}</p>
    </motion.div>
  );
}
