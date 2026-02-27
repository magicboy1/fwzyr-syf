import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import logoUrl from "@assets/logo_1772218489356.png";
import type { QuestionForBigScreen, QuestionReveal, LeaderboardEntry, FinalStats } from "@shared/schema";

const OPTION_COLORS = {
  A: "from-red-500/80 to-red-600/80",
  B: "from-blue-500/80 to-blue-600/80",
  C: "from-emerald-500/80 to-emerald-600/80",
  D: "from-amber-500/80 to-amber-600/80",
};
const OPTION_LABELS = ["A", "B", "C", "D"] as const;

export default function DisplayScreen() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<string>("CONNECTING");
  const [pin, setPin] = useState("");
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [question, setQuestion] = useState<QuestionForBigScreen | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerDuration, setTimerDuration] = useState(0);
  const [reveal, setReveal] = useState<QuestionReveal | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<FinalStats | null>(null);
  const [streakAlert, setStreakAlert] = useState<{ playerName: string; streak: number } | null>(null);
  const [showDoublePoints, setShowDoublePoints] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gamePin = params.get("pin");
    if (!gamePin) {
      navigate("/");
      return;
    }
    setPin(gamePin);

    const socket = getSocket();

    socket.emit("display:join", { pin: gamePin }, (res: any) => {
      if (res.success) {
        setPhase(res.phase || "LOBBY");
        setPlayerCount(res.playerCount || 0);
        setPlayers(res.players || []);
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

    socket.on("game:questionStart", (data) => {
      setQuestion(data.question);
      setPhase("QUESTION");
      setTimerDuration(data.question.timeLimit);
      setTimeLeft(data.question.timeLimit);
      setPaused(false);
      setStreakAlert(null);

      if (timerRef.current) clearInterval(timerRef.current);
      const start = Date.now();
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
        confetti({ particleCount: 200, spread: 120, origin: { y: 0.6 }, colors: ["#CDB58B", "#e8d5a8", "#1e3a5f", "#fff"] });
      }, 500);
      setTimeout(() => {
        confetti({ particleCount: 100, spread: 80, origin: { x: 0.2, y: 0.7 }, colors: ["#CDB58B", "#e8d5a8"] });
      }, 1200);
      setTimeout(() => {
        confetti({ particleCount: 100, spread: 80, origin: { x: 0.8, y: 0.7 }, colors: ["#CDB58B", "#e8d5a8"] });
      }, 1800);
    });

    socket.on("game:streakAlert", (data) => {
      setStreakAlert(data);
      setTimeout(() => setStreakAlert(null), 4000);
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

    socket.on("game:restarted", (data) => {
      setPhase("LOBBY");
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
      setQuestion(null);
      setReveal(null);
      setLeaderboard([]);
      setStats(null);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      socket.off("game:playerJoined");
      socket.off("game:playerLeft");
      socket.off("game:doublePoints");
      socket.off("game:questionStart");
      socket.off("game:questionEnd");
      socket.off("game:reveal");
      socket.off("game:leaderboard");
      socket.off("game:end");
      socket.off("game:streakAlert");
      socket.off("game:paused");
      socket.off("game:resumed");
      socket.off("game:restarted");
    };
  }, []);

  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/join?pin=${pin}`
    : "";

  const timerPercent = timerDuration > 0 ? (timeLeft / timerDuration) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden relative" dir="rtl" data-testid="display-screen">
      <AnimatePresence mode="wait">
        {showDoublePoints && (
          <motion.div
            key="double"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          >
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="text-7xl font-bold text-[#CDB58B]"
              >
                x2
              </motion.div>
              <p className="text-3xl text-[#CDB58B] mt-4 font-semibold">سؤال النقاط المضاعفة!</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {streakAlert && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            className="fixed top-8 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-orange-500 to-red-500 px-10 py-4 rounded-2xl shadow-2xl"
          >
            <p className="text-2xl font-bold text-white text-center">
              {streakAlert.playerName} مشتعل! سلسلة {streakAlert.streak}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "CONNECTING" && (
        <div className="flex items-center justify-center min-h-screen">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-12 h-12 border-4 border-[#CDB58B]/30 border-t-[#CDB58B] rounded-full" />
        </div>
      )}

      {phase === "LOBBY" && <LobbyScreen pin={pin} joinUrl={joinUrl} playerCount={playerCount} players={players} />}
      {phase === "QUESTION" && question && (
        <QuestionScreen question={question} timeLeft={timeLeft} timerPercent={timerPercent} paused={paused} />
      )}
      {phase === "REVEAL" && reveal && <RevealScreen reveal={reveal} question={question} />}
      {phase === "LEADERBOARD" && <LeaderboardScreen leaderboard={leaderboard} />}
      {phase === "END" && stats && <EndScreen stats={stats} />}
    </div>
  );
}

function LobbyScreen({ pin, joinUrl, playerCount, players }: { pin: string; joinUrl: string; playerCount: number; players: { id: string; name: string }[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center p-8" data-testid="lobby-screen">
      <div className="mb-8">
        <img src={logoUrl} alt="السحور السنوي" className="h-20 mx-auto object-contain opacity-90" data-testid="img-logo" />
      </div>

      <motion.h1 initial={{ y: -30 }} animate={{ y: 0 }} className="text-5xl font-bold text-[#CDB58B] mb-2">
        فوازير سيف
      </motion.h1>
      <p className="text-xl text-muted-foreground mb-12">المسابقة التفاعلية المباشرة</p>

      <div className="flex flex-col md:flex-row gap-12 items-center">
        <div className="bg-white p-6 rounded-2xl shadow-2xl" data-testid="qr-code">
          <QRCodeSVG value={joinUrl} size={220} level="H" bgColor="#ffffff" fgColor="#1C1F2A" />
        </div>

        <div className="text-center">
          <p className="text-lg text-muted-foreground mb-3">رمز الدخول</p>
          <div className="flex gap-2 justify-center mb-8" dir="ltr" data-testid="text-pin">
            {pin.split("").map((d, i) => (
              <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.1 }} className="w-16 h-20 flex items-center justify-center text-4xl font-bold bg-gradient-to-b from-card to-muted rounded-xl border border-border/50 text-[#CDB58B]">
                {d}
              </motion.span>
            ))}
          </div>

          <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2, repeat: Infinity }} className="bg-card/80 backdrop-blur rounded-2xl px-10 py-6 border border-[#CDB58B]/20">
            <p className="text-6xl font-bold text-[#CDB58B]" data-testid="text-player-count">{playerCount}</p>
            <p className="text-lg text-muted-foreground mt-1">لاعب انضموا</p>
          </motion.div>
        </div>
      </div>

      {players.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 flex flex-wrap gap-3 justify-center max-w-3xl">
          {players.slice(-20).map((p, i) => (
            <motion.span key={p.id} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} className="px-4 py-2 bg-card rounded-full border border-border/50 text-sm font-medium" data-testid={`text-player-${p.id}`}>
              {p.name}
            </motion.span>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function QuestionScreen({ question, timeLeft, timerPercent, paused }: { question: QuestionForBigScreen; timeLeft: number; timerPercent: number; paused: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col p-8 lg:p-12" data-testid="question-screen">
      <div className="flex items-center justify-between mb-6 gap-4">
        <span className="text-muted-foreground text-lg">
          سؤال {question.index + 1} من {question.totalQuestions}
        </span>
        {question.isDoublePoints && (
          <span className="px-4 py-1 bg-[#CDB58B]/15 border border-[#CDB58B]/40 rounded-full text-[#CDB58B] text-sm font-semibold">
            x2 نقاط مضاعفة
          </span>
        )}
        <div className="flex items-center gap-3">
          {paused && <span className="text-[#CDB58B] font-semibold">متوقف</span>}
          <span className="text-3xl font-bold text-[#CDB58B] tabular-nums" data-testid="text-timer">
            {Math.ceil(timeLeft)}
          </span>
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
        <motion.h2
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-4xl lg:text-5xl font-bold text-center leading-relaxed max-w-4xl mb-16"
          dir="auto"
          data-testid="text-question"
        >
          {question.text}
        </motion.h2>

        <div className="grid grid-cols-2 gap-6 w-full max-w-3xl" dir="ltr">
          {OPTION_LABELS.map((label, i) => (
            <motion.div
              key={label}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              className={`h-28 bg-gradient-to-br ${OPTION_COLORS[label]} rounded-2xl flex items-center justify-center`}
              data-testid={`option-shape-${label}`}
            >
              <span className="text-4xl font-bold text-white/90">{label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function RevealScreen({ reveal, question }: { reveal: QuestionReveal; question: QuestionForBigScreen | null }) {
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

      <div className="grid grid-cols-2 gap-6 mb-10" dir="ltr">
        {OPTION_LABELS.map((label) => {
          const isCorrect = label === reveal.correct;
          return (
            <motion.div
              key={label}
              initial={{ scale: 0.9 }}
              animate={{ scale: isCorrect ? 1.05 : 1 }}
              className={`h-24 bg-gradient-to-br ${OPTION_COLORS[label]} rounded-2xl flex items-center justify-between px-8 relative ${isCorrect ? "ring-4 ring-green-400 shadow-lg shadow-green-400/20" : "opacity-50"}`}
              data-testid={`reveal-option-${label}`}
            >
              <span className="text-3xl font-bold text-white">{label}</span>
              <span className="text-2xl font-bold text-white/90">{reveal.percentages[label]}%</span>
              {isCorrect && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-3 -right-3 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        {reveal.topFastest.length > 0 && (
          <div className="bg-card/50 rounded-2xl p-6 border border-border/30">
            <h3 className="text-lg font-semibold text-[#CDB58B] mb-4">الأسرع إجابة</h3>
            {reveal.topFastest.map((p, i) => (
              <motion.div key={i} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.2 }} className="flex items-center gap-4 mb-3">
                <span className="w-8 h-8 rounded-full bg-[#CDB58B]/20 flex items-center justify-center font-bold text-[#CDB58B] text-sm">{i + 1}</span>
                <span className="font-medium flex-1" dir="auto">{p.name}</span>
                <span className="text-muted-foreground" dir="ltr">{(p.timeMs / 1000).toFixed(1)}ث</span>
              </motion.div>
            ))}
          </div>
        )}

        <div className="bg-card/50 rounded-2xl p-6 border border-border/30">
          <h3 className="text-lg font-semibold text-[#CDB58B] mb-4">أفضل ٥</h3>
          {reveal.leaderboard.slice(0, 5).map((entry, i) => (
            <motion.div key={entry.playerId} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.15 }} className="flex items-center gap-4 mb-3">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-500 text-white" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}>{entry.rank}</span>
              <span className="font-medium flex-1" dir="auto">{entry.name}</span>
              {entry.previousRank !== null && entry.previousRank !== entry.rank && (
                <span className={`text-sm ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}>
                  {entry.rank < entry.previousRank ? `+${entry.previousRank - entry.rank}` : `-${entry.rank - entry.previousRank}`}
                </span>
              )}
              <span className="font-bold text-[#CDB58B] tabular-nums" dir="ltr">{entry.score.toLocaleString()}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function LeaderboardScreen({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center p-8 lg:p-12" data-testid="leaderboard-screen">
      <h2 className="text-4xl font-bold text-[#CDB58B] mb-12">لوحة المتصدرين</h2>
      <div className="w-full max-w-2xl">
        {leaderboard.slice(0, 10).map((entry, i) => (
          <motion.div
            key={entry.playerId}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: i * 0.1 }}
            className={`flex items-center gap-6 mb-4 p-4 rounded-xl ${i < 3 ? "bg-[#CDB58B]/10 border border-[#CDB58B]/20" : "bg-card/50 border border-border/20"}`}
            data-testid={`leaderboard-entry-${i}`}
          >
            <span className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${i === 0 ? "bg-gradient-to-br from-[#CDB58B] to-[#a89160] text-white shadow-lg shadow-[#CDB58B]/30" : i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800" : i === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white" : "bg-muted text-muted-foreground"}`}>
              {entry.rank}
            </span>
            <span className="text-xl font-semibold flex-1" dir="auto">{entry.name}</span>
            {entry.previousRank !== null && entry.previousRank !== entry.rank && (
              <span className={`text-sm font-medium ${entry.rank < entry.previousRank ? "text-green-400" : "text-red-400"}`}>
                {entry.rank < entry.previousRank ? `+${entry.previousRank - entry.rank}` : `-${entry.rank - entry.previousRank}`}
              </span>
            )}
            <span className="text-2xl font-bold text-[#CDB58B] tabular-nums" dir="ltr">{entry.score.toLocaleString()}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function EndScreen({ stats }: { stats: FinalStats }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col items-center p-8 lg:p-12 overflow-y-auto" data-testid="end-screen">
      <img src={logoUrl} alt="الشعار" className="h-12 mb-6 opacity-80" />
      <h2 className="text-4xl font-bold text-[#CDB58B] mb-4">انتهت اللعبة!</h2>

      {stats.podium.length > 0 && (
        <div className="flex items-end justify-center gap-6 mb-12 mt-8">
          {stats.podium.length > 1 && (
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }} className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-2xl font-bold text-gray-800 mb-3 shadow-lg">2</div>
              <p className="font-semibold text-lg mb-1" dir="auto">{stats.podium[1].name}</p>
              <p className="text-[#CDB58B] font-bold" dir="ltr">{stats.podium[1].score.toLocaleString()}</p>
              <div className="w-24 h-24 bg-gradient-to-t from-gray-500/20 to-gray-400/10 rounded-t-lg mt-3" />
            </motion.div>
          )}

          <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="flex flex-col items-center -mb-4">
            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-28 h-28 rounded-full bg-gradient-to-br from-[#CDB58B] via-[#e8d5a8] to-[#a89160] flex items-center justify-center text-4xl font-bold text-white mb-3 shadow-2xl shadow-[#CDB58B]/40">
              1
            </motion.div>
            <p className="font-bold text-2xl mb-1" dir="auto">{stats.podium[0].name}</p>
            <p className="text-[#CDB58B] font-bold text-xl" dir="ltr">{stats.podium[0].score.toLocaleString()}</p>
            <div className="w-28 h-32 bg-gradient-to-t from-[#CDB58B]/20 to-[#CDB58B]/5 rounded-t-lg mt-3" />
          </motion.div>

          {stats.podium.length > 2 && (
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.9 }} className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-2xl font-bold text-white mb-3 shadow-lg">3</div>
              <p className="font-semibold text-lg mb-1" dir="auto">{stats.podium[2].name}</p>
              <p className="text-[#CDB58B] font-bold" dir="ltr">{stats.podium[2].score.toLocaleString()}</p>
              <div className="w-24 h-16 bg-gradient-to-t from-orange-500/20 to-orange-400/10 rounded-t-lg mt-3" />
            </motion.div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl mb-8">
        {stats.fastestCorrect && (
          <StatCard title="أسرع إجابة صحيحة" value={`${(stats.fastestCorrect.timeMs / 1000).toFixed(1)} ثانية`} subtitle={stats.fastestCorrect.playerName} />
        )}
        {stats.bestStreak && (
          <StatCard title="أفضل سلسلة" value={`${stats.bestStreak.streakLength} متتالية`} subtitle={stats.bestStreak.playerName} />
        )}
        {stats.hardestQuestion && (
          <StatCard title="أصعب سؤال" value={`${stats.hardestQuestion.correctPercent}% صحيح`} subtitle={`سؤال ${stats.hardestQuestion.questionIndex + 1}`} />
        )}
        <StatCard title="متوسط وقت الإجابة" value={`${(stats.avgResponseTime / 1000).toFixed(1)} ثانية`} subtitle="جميع اللاعبين" />
        <StatCard title="نسبة المشاركة" value={`${stats.participationRate}%`} subtitle={`${stats.totalPlayers} لاعب`} />
        <StatCard title="عدد الأسئلة" value={`${stats.totalQuestions}`} subtitle="سؤال تم لعبه" />
      </div>
    </motion.div>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-card/60 rounded-xl p-5 border border-border/30 text-center">
      <p className="text-sm text-muted-foreground mb-2">{title}</p>
      <p className="text-2xl font-bold text-[#CDB58B]">{value}</p>
      <p className="text-sm text-muted-foreground mt-1" dir="auto">{subtitle}</p>
    </motion.div>
  );
}
