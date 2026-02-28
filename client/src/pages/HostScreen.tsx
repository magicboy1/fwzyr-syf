import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { Question, GamePhase } from "@shared/schema";
import { Play, SkipForward, Eye, Trophy, Square, Pause, PlayCircle, RefreshCw, UserMinus, Users } from "lucide-react";

export default function HostScreen() {
  const [, navigate] = useLocation();
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [phase, setPhase] = useState<GamePhase>("LOBBY");
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [currentQ, setCurrentQ] = useState(-1);
  const [totalQ, setTotalQ] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeLimit, setTimeLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [isLastQuestion, setIsLastQuestion] = useState(false);

  const { data: questions = [] } = useQuery<Question[]>({
    queryKey: ["/api/questions"],
  });

  const createSession = () => {
    if (questions.length === 0) return;
    setLoading(true);
    const socket = getSocket();
    socket.emit("host:create", { questions, defaultTimeLimit: timeLimit }, (res: any) => {
      setLoading(false);
      if (res.success) {
        setSessionId(res.sessionId);
        setHostKey(res.hostKey);
        setConnected(true);
        setTotalQ(questions.length);
        localStorage.setItem("fawazeer_hostKey", res.hostKey);
        localStorage.setItem("fawazeer_hostSession", res.sessionId);
      }
    });
  };

  useEffect(() => {
    const savedHostKey = localStorage.getItem("fawazeer_hostKey");
    const savedSession = localStorage.getItem("fawazeer_hostSession");
    if (savedHostKey && savedSession) {
      const socket = getSocket();
      socket.emit("host:reconnect", { sessionId: savedSession, hostKey: savedHostKey }, (res: any) => {
        if (res.success) {
          setSessionId(res.session.id);
          setHostKey(savedHostKey);
          setPhase(res.session.phase);
          setCurrentQ(res.session.currentQuestionIndex);
          setPlayerCount(res.session.playerCount);
          setPlayers(res.session.players || []);
          setConnected(true);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    const socket = getSocket();

    socket.on("game:playerJoined", (data) => {
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
    });

    socket.on("game:playerLeft", (data) => {
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
    });

    socket.on("game:context", (data) => {
      setCurrentQ(data.index);
    });

    socket.on("game:questionStart", (data) => {
      setPhase("QUESTION");
      setCurrentQ(data.question.index);
      setTotalQ(data.question.totalQuestions || totalQ);
      setAnsweredCount(0);
    });

    socket.on("game:answerUpdate", (data) => {
      setAnsweredCount(data.answeredCount);
    });

    socket.on("game:reveal", (data: any) => {
      setPhase("REVEAL");
      if (data?.isLastQuestion) setIsLastQuestion(true);
    });
    socket.on("game:leaderboard", () => setPhase("LEADERBOARD"));
    socket.on("game:end", () => setPhase("END"));
    socket.on("game:paused", () => setPaused(true));
    socket.on("game:resumed", () => setPaused(false));
    socket.on("game:hostRestarted", (data) => {
      setPhase("LOBBY");
      setCurrentQ(-1);
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
      setPaused(false);
      setIsLastQuestion(false);
    });

    return () => {
      socket.off("game:playerJoined");
      socket.off("game:playerLeft");
      socket.off("game:questionStart");
      socket.off("game:context");
      socket.off("game:answerUpdate");
      socket.off("game:reveal");
      socket.off("game:leaderboard");
      socket.off("game:end");
      socket.off("game:paused");
      socket.off("game:resumed");
      socket.off("game:hostRestarted");
    };
  }, [connected, totalQ]);

  const emit = (event: string, extra: any = {}) => {
    getSocket().emit(event, { sessionId, hostKey, ...extra }, () => {});
  };

  const handleStart = () => emit("host:start");
  const handleNext = () => { emit("host:next"); setAnsweredCount(0); };
  const handleReveal = () => emit("host:reveal");
  const handleLeaderboard = () => {
    getSocket().emit("host:leaderboard", { sessionId, hostKey }, (res: any) => {
      if (res.isLastQuestion) setIsLastQuestion(true);
    });
  };
  const handleEnd = () => emit("host:end");
  const handlePause = () => emit("host:pause");
  const handleResume = () => emit("host:resume");
  const handleRestart = () => { emit("host:restart"); setIsLastQuestion(false); };
  const handleKick = (playerId: string) => emit("host:kick", { playerId });

  const displayUrl = typeof window !== "undefined" ? `${window.location.origin}/display?s=${sessionId}` : "";

  const openDisplay = () => {
    window.open(displayUrl, "_blank");
  };

  if (!connected) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6" dir="rtl" data-testid="host-setup">
        <h1 className="text-3xl font-bold text-[#CDB58B] mb-2">لوحة تحكم المضيف</h1>
        <p className="text-muted-foreground mb-8">إنشاء جلسة مسابقة جديدة</p>

        <div className="w-full max-w-md space-y-6">
          <div className="bg-card rounded-xl p-6 border border-border/30">
            <p className="text-sm text-muted-foreground mb-2">الأسئلة المحملة</p>
            <p className="text-3xl font-bold text-[#CDB58B]">{questions.length}</p>
            <Button variant="secondary" className="mt-3" onClick={() => navigate("/admin")} data-testid="button-manage-questions">
              إدارة الأسئلة
            </Button>
          </div>

          <div className="bg-card rounded-xl p-6 border border-border/30">
            <label className="text-sm text-muted-foreground mb-2 block">الوقت لكل سؤال (ثواني)</label>
            <Input
              type="number"
              value={timeLimit}
              onChange={(e) => setTimeLimit(Math.max(5, Math.min(120, parseInt(e.target.value) || 30)))}
              className="bg-muted"
              min={5}
              max={120}
              dir="ltr"
              data-testid="input-time-limit"
            />
          </div>

          <Button onClick={createSession} disabled={questions.length === 0 || loading} className="w-full h-14 text-lg font-semibold" data-testid="button-create-session">
            {loading ? "جاري الإنشاء..." : "إنشاء الجلسة"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6" dir="rtl" data-testid="host-panel">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#CDB58B]">لوحة المضيف</h1>
          </div>
          <div className="text-left">
            <p className="text-sm text-muted-foreground">المرحلة</p>
            <p className="font-semibold text-[#CDB58B]">
              {phase === "LOBBY" ? "الانتظار" : phase === "QUESTION" ? "سؤال" : phase === "REVEAL" ? "النتائج" : phase === "LEADERBOARD" ? "الترتيب" : "انتهت"}
            </p>
          </div>
        </div>

        <div className="bg-card rounded-xl p-4 border border-border/30 mb-6">
          <p className="text-sm text-muted-foreground mb-2">الشاشة الرئيسية</p>
          <Button onClick={openDisplay} variant="secondary" className="w-full" data-testid="button-open-display">
            فتح الشاشة الرئيسية
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <motion.div layout className="bg-card rounded-xl p-4 border border-border/30 text-center">
            <Users className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <motion.p key={playerCount} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-2xl font-bold text-[#CDB58B]" data-testid="text-host-player-count">{playerCount}</motion.p>
            <p className="text-xs text-muted-foreground">لاعبين</p>
          </motion.div>
          <motion.div layout className="bg-card rounded-xl p-4 border border-border/30 text-center">
            <motion.p key={currentQ} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-2xl font-bold text-[#CDB58B]" dir="ltr">{currentQ >= 0 ? `${currentQ + 1}/${totalQ}` : "-"}</motion.p>
            <p className="text-xs text-muted-foreground">السؤال</p>
          </motion.div>
        </div>

        {phase === "QUESTION" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-xl p-4 border border-border/30 mb-6">
            <p className="text-sm text-muted-foreground mb-1">الإجابات المستلمة</p>
            <motion.p key={answeredCount} initial={{ scale: 1.2 }} animate={{ scale: 1 }} className="text-xl font-bold text-[#CDB58B]" dir="ltr">{answeredCount} / {playerCount}</motion.p>
            <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
              <motion.div className="h-full bg-[#CDB58B] rounded-full" animate={{ width: `${playerCount > 0 ? (answeredCount / playerCount) * 100 : 0}%` }} transition={{ type: "spring", bounce: 0.3 }} />
            </div>
          </motion.div>
        )}

        <div className="space-y-3 mb-8">
          {phase === "LOBBY" && (
            <Button onClick={() => { handleStart(); handleNext(); }} className="w-full h-12" disabled={playerCount === 0} data-testid="button-start-game">
              <Play className="w-5 h-5 ml-2" /> ابدأ اللعبة
            </Button>
          )}

          {phase === "QUESTION" && (
            <>
              {!paused ? (
                <Button onClick={handlePause} variant="secondary" className="w-full h-12" data-testid="button-pause">
                  <Pause className="w-5 h-5 ml-2" /> إيقاف مؤقت
                </Button>
              ) : (
                <Button onClick={handleResume} className="w-full h-12" data-testid="button-resume">
                  <PlayCircle className="w-5 h-5 ml-2" /> استئناف
                </Button>
              )}
              <Button onClick={handleReveal} className="w-full h-12" data-testid="button-reveal">
                <Eye className="w-5 h-5 ml-2" /> كشف الإجابة
              </Button>
            </>
          )}

          {phase === "REVEAL" && !isLastQuestion && (
            <Button onClick={handleNext} className="w-full h-12" data-testid="button-next-question">
              <SkipForward className="w-5 h-5 ml-2" /> السؤال التالي
            </Button>
          )}

          {phase === "REVEAL" && isLastQuestion && (
            <Button onClick={handleEnd} className="w-full h-12 bg-[#CDB58B] hover:bg-[#b9a178] text-[#1C1F2A]" data-testid="button-finish-game">
              <Trophy className="w-5 h-5 ml-2" /> عرض النتائج النهائية
            </Button>
          )}

          {(phase === "REVEAL" || phase === "LEADERBOARD") && (
            <Button onClick={handleLeaderboard} variant="secondary" className="w-full h-12" data-testid="button-show-leaderboard">
              <Trophy className="w-5 h-5 ml-2" /> عرض الترتيب
            </Button>
          )}

          {phase === "LEADERBOARD" && !isLastQuestion && (
            <Button onClick={handleNext} className="w-full h-12" data-testid="button-next-question">
              <SkipForward className="w-5 h-5 ml-2" /> السؤال التالي
            </Button>
          )}

          {phase === "LEADERBOARD" && isLastQuestion && (
            <Button onClick={handleEnd} className="w-full h-12 bg-[#CDB58B] hover:bg-[#b9a178] text-[#1C1F2A]" data-testid="button-finish-game">
              <Trophy className="w-5 h-5 ml-2" /> عرض النتائج النهائية
            </Button>
          )}

          {phase === "QUESTION" && (
            <Button onClick={handleEnd} variant="destructive" className="w-full h-12" data-testid="button-end-game">
              <Square className="w-5 h-5 ml-2" /> إنهاء اللعبة
            </Button>
          )}

          {phase === "END" && (
            <Button onClick={handleRestart} variant="secondary" className="w-full h-12" data-testid="button-restart">
              <RefreshCw className="w-5 h-5 ml-2" /> إعادة اللعبة
            </Button>
          )}
        </div>

        {players.length > 0 && (
          <div className="bg-card rounded-xl p-4 border border-border/30">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> اللاعبون</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {players.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                  <span className="text-sm font-medium" dir="auto">{p.name}</span>
                  <Button size="icon" variant="ghost" onClick={() => handleKick(p.id)} data-testid={`button-kick-${p.id}`}>
                    <UserMinus className="w-4 h-4 text-red-400" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
