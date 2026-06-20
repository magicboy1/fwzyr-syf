import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import { Maximize, Minimize } from "lucide-react";
import { BRAND } from "@/brand";
import { REGIONS } from "@shared/schema";
import { valueByCategory } from "@/lib/values";
import type { QuestionForBigScreen, QuestionReveal, LeaderboardEntry, FinalStats } from "@shared/schema";

const REGION_LABEL: Record<string, string> = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));

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
  const [contextData, setContextData] = useState<{ context: string; category?: string; index: number; totalQuestions: number } | null>(null);
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
    const joinDisplay = () => socket.emit("display:join", { sessionId: sId }, (res: any) => {
      if (res.success) {
        setPhase(res.phase || "LOBBY");
        setPlayerCount(res.playerCount || 0);
        setPlayers(res.players || []);
        // hydrate if the screen opened/refreshed mid-game (else it's blank)
        if (res.phase === "QUESTION" && res.question) {
          setQuestion(res.question);
          setTimerDuration(res.question.timeLimit);
          setTimeLeft(res.timeLeft || 0);
          startTimer(res.timeLeft || 0);
        } else if (res.phase === "REVEAL" && res.reveal) {
          setReveal(res.reveal);
          if (res.question) setQuestion(res.question);
        } else if (res.phase === "LEADERBOARD" && res.leaderboard) {
          setLeaderboard(res.leaderboard);
        } else if (res.phase === "END" && res.stats) {
          setStats(res.stats);
        }
      } else {
        setPhase("ERROR");
      }
    });
    joinDisplay();
    // re-join automatically after the socket reconnects (e.g. server redeploy/restart)
    socket.io.on("reconnect", joinDisplay);

    socket.on("game:playerJoined", (data) => {
      setPlayerCount(data.playerCount);
      if (data.player) {
        setPlayers((prev) =>
          prev.some((p) => p.id === data.player.id) ? prev : [...prev, data.player]
        );
      } else if (data.players) {
        setPlayers(data.players);
      }
    });

    socket.on("game:playerLeft", (data) => {
      setPlayerCount(data.playerCount);
      if (data.playerId) {
        setPlayers((prev) => prev.filter((p) => p.id !== data.playerId));
      }
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
        confetti({ particleCount: 3, angle: 60 + Math.random() * 60, spread: 55, origin: { x: Math.random(), y: 0.6 }, colors: [BRAND.colors.gold, "#22c55e", BRAND.colors.goldLight], disableForReducedMotion: true });
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
      setPlayerCount(0);
      setPlayers([]);
    });

    socket.on("game:doublePoints", () => {
      setShowDoublePoints(true);
      setTimeout(() => setShowDoublePoints(false), 2500);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      socket.io.off("reconnect", joinDisplay);
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
    <div className="min-h-screen text-foreground overflow-hidden" dir="ltr" data-testid="display-screen">
      <button
        onClick={toggleFullscreen}
        className="fixed top-4 left-4 z-[60] p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
        data-testid="button-fullscreen"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
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
                className="text-8xl font-bold text-gold drop-shadow-[0_0_30px_rgba(205,181,139,0.5)]"
              >
                x2
              </motion.div>
              <motion.p
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-3xl text-gold mt-6 font-semibold"
              >
                Double Points Question!
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
                className="text-9xl font-black text-gold drop-shadow-[0_0_60px_rgba(205,181,139,0.6)]"
              >
                {countdownNum}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "CONNECTING" && (
        <div className="flex items-center justify-center min-h-screen">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-12 h-12 border-4 border-gold/30 border-t-gold rounded-full" />
        </div>
      )}

      {phase === "ERROR" && (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <h2 className="text-3xl font-bold text-gold mb-4">Session not found</h2>
          <p className="text-muted-foreground">Create a new session from the host panel</p>
        </div>
      )}

      {phase === "LOBBY" && <LobbyScreen sessionId={sessionId} joinUrl={joinUrl} playerCount={playerCount} isPortrait={isPortrait} />}
      {phase === "CONTEXT" && contextData && <ContextScreen context={contextData.context} category={contextData.category} index={contextData.index} totalQuestions={contextData.totalQuestions} isPortrait={isPortrait} />}
      {phase === "QUESTION" && question && (
        <QuestionScreen question={question} timeLeft={timeLeft} timerPercent={timerPercent} paused={paused} answeredCount={answeredCount} totalPlayers={totalPlayers} contextText={contextData?.context} isPortrait={isPortrait} />
      )}
      {phase === "REVEAL" && reveal && <RevealScreen reveal={reveal} question={question} isPortrait={isPortrait} />}
      {phase === "LEADERBOARD" && <LeaderboardScreen leaderboard={leaderboard} isPortrait={isPortrait} />}
      {phase === "END" && stats && <EndScreen stats={stats} isPortrait={isPortrait} />}
    </div>
  );
}

function ContextScreen({ context, category, index, totalQuestions, isPortrait }: { context: string; category?: string; index: number; totalQuestions: number; isPortrait: boolean }) {
  const value = valueByCategory(category);
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

  // Fallback (no matching value) — keep the old neutral intro.
  if (!value) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-16" data-testid="context-screen">
        <motion.div className="bg-card/80 border border-gold/20 rounded-2xl" style={{ maxWidth: "80%", padding: "clamp(32px, 3vw, 72px)" }}>
          <p className="ds-question text-foreground text-center leading-relaxed font-bold" dir="auto" data-testid="text-context">{context}</p>
        </motion.div>
      </motion.div>
    );
  }

  const onWhite = value.onColor === "white";
  const textMain = onWhite ? "#ffffff" : "#15233a";
  const subtle = onWhite ? "rgba(255,255,255,0.78)" : "rgba(21,35,58,0.7)";
  const chipBg = onWhite ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.08)";
  const chipBorder = onWhite ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.18)";
  const barFill = onWhite ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.45)";

  return (
    <motion.div
      {...pFade}
      className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-16 text-center"
      style={{ background: value.color, color: textMain }}
      data-testid="context-screen"
    >
      <motion.span initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="ds-small font-semibold tracking-[0.25em] uppercase mb-6" style={{ color: subtle }}>
        Core Value
      </motion.span>

      {/* icon (swapped to the real SVG once provided) */}
      <motion.div
        initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.2, type: "spring", bounce: 0.45 }}
        className="mb-6 flex items-center justify-center rounded-3xl"
        style={{ width: "clamp(96px, 9vw, 190px)", height: "clamp(96px, 9vw, 190px)", background: chipBg, border: `2px solid ${chipBorder}` }}
        data-testid="value-icon"
      >
        {value.icon
          ? <div aria-hidden style={{
              width: "62%", height: "62%", backgroundColor: textMain,
              WebkitMaskImage: `url("${value.icon}")`, maskImage: `url("${value.icon}")`,
              WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
              WebkitMaskPosition: "center", maskPosition: "center",
              WebkitMaskSize: "contain", maskSize: "contain",
            }} />
          : <span className="ds-question font-bold" style={{ color: textMain }}>{value.name.charAt(0)}</span>}
      </motion.div>

      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        className="ds-question font-bold leading-tight mb-7" style={{ maxWidth: "88%" }} dir="auto" data-testid="text-value-name">
        {value.name}
      </motion.h1>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
        className="flex flex-wrap items-center justify-center gap-3 mb-10" style={{ maxWidth: "82%" }}>
        {value.behaviors.map((b, i) => (
          <motion.span key={b} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 + i * 0.08, type: "spring", bounce: 0.4 }}
            className="ds-secondary font-semibold rounded-full px-6 py-2" style={{ background: chipBg, border: `1px solid ${chipBorder}`, color: textMain }}>
            {b}
          </motion.span>
        ))}
      </motion.div>

      <div style={{ width: "clamp(200px, 15vw, 400px)" }}>
        <div className="w-full rounded-full overflow-hidden" style={{ height: "clamp(6px, 0.3vw, 12px)", background: chipBg }}>
          <div className="h-full rounded-full transition-all duration-100" style={{ width: `${progress}%`, background: barFill }} />
        </div>
        <p className="ds-small text-center mt-2" style={{ color: subtle }}>Question coming up...</p>
      </div>
    </motion.div>
  );
}

function LobbyScreen({ sessionId, joinUrl, playerCount, isPortrait }: { sessionId: string; joinUrl: string; playerCount: number; isPortrait: boolean }) {
  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col items-center justify-center" style={{ padding: "5%" }} data-testid="lobby-screen">
        <div style={{ maxWidth: "80%" }} className="flex flex-col items-center text-center w-full">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} className="mb-6">
            <img src={BRAND.logo} alt={BRAND.eventName} className="h-16 mx-auto object-contain opacity-90" data-testid="img-logo" />
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="ds-secondary text-muted-foreground mb-8">
            Scan the code to join
          </motion.p>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-white p-6 rounded-3xl shadow-2xl shadow-gold/10 mb-8"
            data-testid="qr-code"
          >
            <QRCodeSVG value={joinUrl} size={220} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
          </motion.div>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="bg-card/80 backdrop-blur rounded-2xl px-10 py-5 border border-gold/20"
          >
            <motion.p key={playerCount} initial={{ scale: 1.5, color: BRAND.colors.goldLight }} animate={{ scale: 1, color: BRAND.colors.gold }} className="text-5xl font-bold text-gold" data-testid="text-player-count">
              {playerCount}
            </motion.p>
            <p className="ds-small text-muted-foreground mt-1">players joined</p>
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
          className="bg-white rounded-3xl shadow-2xl shadow-gold/20 flex-shrink-0"
          style={{ padding: "clamp(24px, 2.5vw, 56px)" }}
          data-testid="qr-code"
        >
          <QRCodeSVG value={joinUrl} size={Math.min(Math.max(Math.round(window.innerHeight * 0.55), 280), 700)} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
        </motion.div>

        <div className="flex flex-col items-center text-center">
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.4 }} className="mb-6">
            <img src={BRAND.logo} alt={BRAND.eventName} className="mx-auto object-contain opacity-90" style={{ height: "clamp(64px, 8vh, 160px)" }} data-testid="img-logo" />
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="ds-secondary text-muted-foreground mb-10">
            Scan the code to join
          </motion.p>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="bg-card/80 backdrop-blur rounded-2xl border border-gold/20"
            style={{ padding: "clamp(16px, 2vw, 48px) clamp(32px, 4vw, 80px)" }}
          >
            <motion.p key={playerCount} initial={{ scale: 1.5, color: BRAND.colors.goldLight }} animate={{ scale: 1, color: BRAND.colors.gold }} className="font-bold text-gold" style={{ fontSize: "clamp(48px, 8vw, 180px)" }} data-testid="text-player-count">
              {playerCount}
            </motion.p>
            <p className="ds-secondary text-muted-foreground mt-1">players joined</p>
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
          stroke={isLow ? "#ef4444" : BRAND.colors.gold}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-100"
        />
      </svg>
      <motion.span
        className={`absolute font-bold tabular-nums ${isLow ? "text-red-400" : "text-gold"}`}
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
  // Tint the slide with the value's colour. When no value matches we fall back
  // to the default dark theme (all `tv` values stay undefined).
  const value = valueByCategory(question.category);
  const onWhite = value ? value.onColor === "white" : true;
  const tv = value ? {
    bg: value.color,
    main: onWhite ? "#ffffff" : "#15233a",
    subtle: onWhite ? "rgba(255,255,255,0.82)" : "rgba(21,35,58,0.72)",
    track: onWhite ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)",
    bar: onWhite ? "#ffffff" : "#15233a",
  } : null;
  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col" style={{ padding: "5%", ...(tv ? { background: tv.bg, color: tv.main } : {}) }} data-testid="question-screen">
        <div style={{ maxWidth: "80%", margin: "0 auto" }} className="flex flex-col items-center flex-1 w-full">
          <div className="flex items-center justify-center gap-3 mb-3 w-full">
            <img src={BRAND.logo} alt="" className="h-8 object-contain opacity-70" />
            <span className="ds-small text-muted-foreground font-semibold" style={tv ? { color: tv.subtle } : undefined}>{BRAND.name}</span>
          </div>

          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ds-secondary text-muted-foreground mb-2" style={tv ? { color: tv.subtle } : undefined}>
            Question {question.index + 1} of {question.totalQuestions}
          </motion.span>

          {question.isDoublePoints && (
            <motion.span animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1, repeat: Infinity }} className="px-4 py-1 bg-gold/15 border border-gold/40 rounded-full text-gold ds-small font-semibold mb-3">
              x2 Double Points
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

          <div className="flex items-center justify-center gap-6 ds-small text-muted-foreground mt-auto" style={tv ? { color: tv.subtle } : undefined}>
            <span dir="ltr" data-testid="text-answered-count">{answeredCount}/{totalPlayers} answered</span>
            {paused && <span className="text-gold font-semibold" style={tv ? { color: tv.main } : undefined}>Paused</span>}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" style={tv ? { background: tv.bg, color: tv.main } : undefined} data-testid="question-screen">
      <div className="flex items-center justify-between mb-6 gap-4">
        <motion.span initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="text-muted-foreground ds-secondary" style={tv ? { color: tv.subtle } : undefined}>
          Question {question.index + 1} of {question.totalQuestions}
        </motion.span>
        {question.isDoublePoints && (
          <motion.span animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1, repeat: Infinity }} className="px-4 py-1 bg-gold/15 border border-gold/40 rounded-full text-gold ds-small font-semibold">
            x2 Double Points
          </motion.span>
        )}
        <div className="flex items-center gap-6">
          <motion.span key={answeredCount} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-muted-foreground ds-secondary" style={tv ? { color: tv.subtle } : undefined} data-testid="text-answered-count" dir="ltr">
            {answeredCount}/{totalPlayers}
          </motion.span>
          {paused && <span className="text-gold font-semibold ds-secondary" style={tv ? { color: tv.main } : undefined}>Paused</span>}
          <motion.span
            className={`font-bold tabular-nums ds-question ${timeLeft <= 5 ? "text-red-400" : "text-gold"}`}
            style={tv && timeLeft > 5 ? { color: tv.main } : undefined}
            animate={timeLeft <= 5 && timeLeft > 0 ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 0.5, repeat: Infinity }}
            data-testid="text-timer"
          >
            {Math.ceil(timeLeft)}
          </motion.span>
        </div>
      </div>
      <div className="w-full bg-muted rounded-full overflow-hidden mb-10" style={{ height: "clamp(12px, 0.5vw, 24px)", ...(tv ? { background: tv.track } : {}) }}>
        <motion.div
          className="h-full rounded-full"
          style={{
            width: `${timerPercent}%`,
            background: tv ? tv.bar : (timerPercent > 30 ? `linear-gradient(90deg, ${BRAND.colors.gold}, ${BRAND.colors.goldLight})` : timerPercent > 10 ? `linear-gradient(90deg, ${BRAND.colors.goldAccent}, ${BRAND.colors.gold})` : `linear-gradient(90deg, #c44, ${BRAND.colors.goldAccent})`),
          }}
          transition={{ duration: 0.1 }}
        />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center">
        {contextText && (
          <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="ds-secondary text-muted-foreground/70 text-center mb-4 italic" style={{ maxWidth: "80%", ...(tv ? { color: tv.subtle } : {}) }} dir="auto" data-testid="text-context-ref">
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
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 }, colors: [BRAND.colors.gold, "#22c55e", BRAND.colors.goldLight] });
  }, []);

  const fastestSection = reveal.topFastest.length > 0 ? (
    <motion.div
      initial={isPortrait ? { opacity: 0, scale: 0.95 } : { x: -40, opacity: 0 }}
      animate={isPortrait ? { opacity: 1, scale: 1 } : { x: 0, opacity: 1 }}
      transition={{ delay: 0.5 }}
      className="bg-card/75 rounded-2xl p-6 border border-border/30 w-full"
    >
      <h3 className={`font-semibold text-gold mb-4 ${isPortrait ? "ds-secondary text-center" : "ds-secondary"}`}>⚡ Fastest Answers</h3>
      {reveal.topFastest.map((p, i) => (
        <motion.div
          key={i}
          initial={isPortrait ? { opacity: 0, scale: 0.95 } : { x: 30, opacity: 0 }}
          animate={isPortrait ? { opacity: 1, scale: 1 } : { x: 0, opacity: 1 }}
          transition={{ delay: 0.6 + i * 0.15, type: "spring" }}
          className="flex items-center gap-4 mb-3"
        >
          <span className={`rounded-full bg-gold/20 flex items-center justify-center font-bold text-gold ds-small`} style={{ width: isPortrait ? "clamp(32px, 4vw, 56px)" : "clamp(32px, 2.5vw, 56px)", height: isPortrait ? "clamp(32px, 4vw, 56px)" : "clamp(32px, 2.5vw, 56px)" }}>{i + 1}</span>
          <span className="font-medium flex-1 ds-small" dir="auto">{p.name}</span>
          <span className="text-muted-foreground ds-small" dir="ltr">{(p.timeMs / 1000).toFixed(1)}s</span>
        </motion.div>
      ))}
    </motion.div>
  ) : null;

  if (isPortrait) {
    return (
      <motion.div {...pFade} className="min-h-screen flex flex-col overflow-y-auto" style={{ padding: "5%" }} data-testid="reveal-screen">
        <div style={{ maxWidth: "85%", margin: "0 auto" }} className="w-full flex flex-col items-center">
          <p className="ds-secondary text-muted-foreground mb-2">Question {reveal.questionIndex + 1}</p>
          {question && <h2 className="ds-question font-bold text-center mb-5" dir="auto">{question.text}</h2>}

          {reveal.isDoublePoints && (
            <div className="text-center mb-4">
              <span className="px-5 py-2 bg-gold/15 border border-gold/40 rounded-full text-gold ds-secondary font-semibold">x2 Double Points</span>
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
                  className={`rounded-xl flex items-center gap-3 px-5 py-4 border-2 ${isCorrect ? "bg-green-500/15 border-green-400 shadow-lg shadow-green-400/10" : "bg-card/75 border-border/20 opacity-80"}`}
                  data-testid={`reveal-option-${label}`}
                >
                  {isCorrect && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring" }} className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </motion.span>
                  )}
                  <span className={`ds-option font-semibold flex-1 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="auto">{reveal.options?.[i] || label}</span>
                  <span className={`ds-option font-bold tabular-nums ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="ltr">{reveal.percentages[label]}%</span>
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col justify-center items-center px-8 lg:px-16 py-10" data-testid="reveal-screen">
      <div className="w-full max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-muted-foreground ds-small mb-2">Question {reveal.questionIndex + 1}</p>
          {question && <h2 className="ds-secondary font-bold leading-snug" dir="auto">{question.text}</h2>}
          {reveal.isDoublePoints && (
            <span className="inline-block mt-3 px-4 py-1 bg-gold/15 border border-gold/40 rounded-full text-gold ds-small font-semibold">x2 Double Points</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-5 md:gap-6">
          {OPTION_LABELS.map((label, i) => {
            const isCorrect = label === reveal.correct;
            const optionText = reveal.options?.[i] || label;
            return (
              <motion.div
                key={label}
                initial={{ scale: 0.85, opacity: 0, y: 16 }}
                animate={{ scale: isCorrect ? 1.03 : 1, opacity: 1, y: 0 }}
                transition={{ delay: i * 0.12, type: "spring", bounce: 0.35 }}
                className={`rounded-2xl flex items-center gap-4 border-2 ${isCorrect ? "bg-green-500/15 border-green-400 shadow-lg shadow-green-400/10" : "bg-card/75 border-border/20 opacity-80"}`}
                style={{ padding: "clamp(18px, 1.5vw, 32px)" }}
                data-testid={`reveal-option-${label}`}
              >
                {isCorrect && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring", bounce: 0.5 }} className="rounded-full bg-green-500 flex items-center justify-center shrink-0" style={{ width: "clamp(30px, 2.2vw, 48px)", height: "clamp(30px, 2.2vw, 48px)" }}>
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </motion.span>
                )}
                <span className={`ds-option font-semibold flex-1 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="auto">{optionText}</span>
                <span className={`ds-option font-bold tabular-nums shrink-0 ${isCorrect ? "text-green-400" : "text-muted-foreground"}`} dir="ltr">
                  {reveal.percentages[label]}%
                </span>
              </motion.div>
            );
          })}
        </div>
        {fastestSection && <div className="mt-8 max-w-2xl mx-auto">{fastestSection}</div>}
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
          <motion.h2 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ds-question font-bold text-gold mb-8">
            Leaderboard
          </motion.h2>
          <div className="w-full space-y-3">
            {items.map((entry, i) => (
              <motion.div
                key={entry.playerId}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.12 }}
                className={`flex items-center gap-4 p-4 rounded-xl ${i < 3 ? "bg-card/80 border border-gold/45" : "bg-card/75 border border-border/20"}`}
                data-testid={`leaderboard-entry-${i}`}
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.12 + 0.2, type: "spring", bounce: 0.5 }}
                  className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${i === 0 ? "bg-gradient-to-br from-gold to-gold-dark text-white shadow-lg shadow-gold/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}
                >
                  {entry.rank}
                </motion.span>
                <span className="flex-1 min-w-0 flex items-center gap-2">
              <span className="ds-secondary font-semibold truncate" dir="auto">{entry.name}</span>
              {entry.region && <span className="ds-small text-gold-accent font-medium shrink-0">{REGION_LABEL[entry.region] || entry.region}</span>}
            </span>
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
                  className="ds-secondary font-bold text-gold tabular-nums"
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
      <motion.h2 initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.4 }} className="ds-question font-bold text-gold mb-12">
        Leaderboard
      </motion.h2>
      <div className="w-full" style={{ maxWidth: "70%" }}>
        {leaderboard.slice(0, 10).map((entry, i) => (
          <motion.div
            key={entry.playerId}
            initial={{ x: i % 2 === 0 ? -80 : 80, opacity: 0, scale: 0.9 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.12, type: "spring", bounce: 0.3 }}
            className={`flex items-center gap-6 mb-4 rounded-xl ${i < 3 ? "bg-card/80 border border-gold/45" : "bg-card/75 border border-border/20"}`}
            style={{ padding: "clamp(12px, 1vw, 24px)" }}
            data-testid={`leaderboard-entry-${i}`}
          >
            <motion.span
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: i * 0.12 + 0.2, type: "spring", bounce: 0.5 }}
              className={`rounded-full flex items-center justify-center font-bold ds-secondary ${i === 0 ? "bg-gradient-to-br from-gold to-gold-dark text-white shadow-lg shadow-gold/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}
              style={{ width: "clamp(40px, 3vw, 72px)", height: "clamp(40px, 3vw, 72px)" }}
            >
              {entry.rank}
            </motion.span>
            <span className="flex-1 min-w-0 flex items-center gap-2">
              <span className="ds-secondary font-semibold truncate" dir="auto">{entry.name}</span>
              {entry.region && <span className="ds-small text-gold-accent font-medium shrink-0">{REGION_LABEL[entry.region] || entry.region}</span>}
            </span>
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
              className="ds-secondary font-bold text-gold tabular-nums"
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
          <motion.img initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} src={BRAND.logo} alt="Logo" className="h-10 mb-4" />
          <motion.h2 initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="ds-question font-bold text-gold mb-6">
            Game Over!
          </motion.h2>

          {stats.podium.length > 0 && (
            <div className="flex items-end justify-center gap-4 mb-8 w-full">
              {stats.podium.length > 1 && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 }} className="flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-xl font-bold text-gray-800 mb-2 shadow-lg">2</div>
                  <p className="font-semibold ds-small mb-1 text-center" dir="auto">{stats.podium[1].name}</p>
                  <p className="text-gold font-bold ds-small" dir="ltr">{stats.podium[1].score.toLocaleString()}</p>
                  <motion.div initial={{ height: 0 }} animate={{ height: 80 }} transition={{ delay: 0.8, duration: 0.5 }} className="w-24 bg-gradient-to-t from-gray-500/20 to-gray-400/10 rounded-t-lg mt-2" />
                </motion.div>
              )}
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="flex flex-col items-center">
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-24 h-24 rounded-full bg-gradient-to-br from-gold via-gold-light to-gold-dark flex items-center justify-center text-3xl font-bold text-white mb-2 shadow-2xl shadow-gold/40">
                  1
                </motion.div>
                <p className="font-bold ds-secondary mb-1 text-center" dir="auto">{stats.podium[0].name}</p>
                <p className="text-gold font-bold ds-secondary" dir="ltr">{stats.podium[0].score.toLocaleString()}</p>
                <motion.div initial={{ height: 0 }} animate={{ height: 120 }} transition={{ delay: 0.5, duration: 0.6 }} className="w-28 bg-gradient-to-t from-gold/20 to-gold/5 rounded-t-lg mt-2" />
              </motion.div>
              {stats.podium.length > 2 && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.1 }} className="flex flex-col items-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-xl font-bold text-white mb-2 shadow-lg">3</div>
                  <p className="font-semibold ds-small mb-1 text-center" dir="auto">{stats.podium[2].name}</p>
                  <p className="text-gold font-bold ds-small" dir="ltr">{stats.podium[2].score.toLocaleString()}</p>
                  <motion.div initial={{ height: 0 }} animate={{ height: 56 }} transition={{ delay: 1.1, duration: 0.4 }} className="w-24 bg-gradient-to-t from-orange-500/20 to-orange-400/10 rounded-t-lg mt-2" />
                </motion.div>
              )}
            </div>
          )}

          <RegionWinners stats={stats} isPortrait={true} />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-screen flex flex-col items-center p-6 lg:p-8 overflow-hidden" data-testid="end-screen">
      <motion.img initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 0.8 }} transition={{ type: "spring", bounce: 0.4 }} src={BRAND.logo} alt="Logo" style={{ height: "clamp(36px, 3vw, 64px)" }} className="mb-2" />
      <motion.h2 initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }} className="ds-secondary font-bold text-gold mb-3">
        Game Over!
      </motion.h2>
      {stats.winner && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: "spring", bounce: 0.4 }}
          className="flex items-center gap-3 mb-4 bg-card/80 border border-gold/30 rounded-2xl px-5 py-2"
        >
          <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} className="rounded-full bg-gradient-to-br from-gold via-gold-light to-gold-dark text-white font-bold flex items-center justify-center shrink-0" style={{ width: "clamp(32px, 2.6vw, 52px)", height: "clamp(32px, 2.6vw, 52px)" }}>1</motion.span>
          <span className="font-bold ds-secondary" dir="auto">{stats.winner.name}</span>
          <span className="text-gold font-bold ds-secondary" dir="ltr">{stats.winner.score.toLocaleString()}</span>
        </motion.div>
      )}
      <RegionWinners stats={stats} isPortrait={false} fill />
    </motion.div>
  );
}

function RegionWinners({ stats, isPortrait, fill = false }: { stats: FinalStats; isPortrait: boolean; fill?: boolean }) {
  const regions = stats.regionResults || [];
  if (regions.length === 0) return null;
  return (
    <div
      className={`grid w-full gap-4 ${isPortrait ? "grid-cols-1" : "grid-cols-3"} ${fill ? "flex-1 min-h-0" : ""}`}
      style={{ maxWidth: isPortrait ? "100%" : "94%" }}
      data-testid="region-winners"
    >
      {regions.map((r, ri) => (
        <motion.div
          key={r.key}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 + ri * 0.15, type: "spring", bounce: 0.3 }}
          className="bg-card/80 rounded-2xl border border-gold/25 flex flex-col overflow-hidden min-h-0"
        >
          <div className="flex items-baseline justify-center gap-2 px-3 py-2 bg-gold/10 border-b border-gold/25 shrink-0">
            <h3 className="ds-small font-bold text-gold leading-tight">{r.label}</h3>
            <p className="ds-winner text-gold-accent font-semibold">{r.winners.length}/{r.winnerCount}</p>
          </div>
          <ol
            className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1"
            style={fill ? undefined : { maxHeight: isPortrait ? "40vh" : "62vh" }}
          >
            {r.winners.map((w, i) => (
              <li key={w.playerId} className="flex items-center gap-2 rounded-lg px-2 py-0.5 odd:bg-white/[0.03]">
                <span className={`w-6 text-center font-bold ds-winner ${i < 3 ? "text-gold-accent" : "text-muted-foreground"}`} dir="ltr">{i + 1}</span>
                <span className="flex-1 truncate font-medium ds-winner" dir="auto">{w.name}</span>
                <span className="text-gold font-bold ds-winner" dir="ltr">{w.score.toLocaleString()}</span>
              </li>
            ))}
            {r.winners.length === 0 && (
              <li className="text-muted-foreground text-center ds-small py-6">No winners from this region</li>
            )}
          </ol>
        </motion.div>
      ))}
    </div>
  );
}

function StatCard({ title, value, subtitle, delay = 0, isPortrait = false }: { title: string; value: string; subtitle: string; delay?: number; isPortrait?: boolean }) {
  return (
    <motion.div
      initial={isPortrait ? { opacity: 0, scale: 0.95 } : { y: 30, opacity: 0, scale: 0.9 }}
      animate={isPortrait ? { opacity: 1, scale: 1 } : { y: 0, opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", bounce: 0.3 }}
      className="bg-card/80 rounded-xl p-4 border border-border/30 text-center"
    >
      <p className="text-muted-foreground mb-1 ds-small">{title}</p>
      <motion.p
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: delay + 0.2, type: "spring", bounce: 0.5 }}
        className="font-bold text-gold ds-secondary"
      >
        {value}
      </motion.p>
      <p className="text-muted-foreground mt-1 ds-small" dir="auto">{subtitle}</p>
    </motion.div>
  );
}
