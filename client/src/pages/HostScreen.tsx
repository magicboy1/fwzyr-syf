import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Question, GamePhase } from "@shared/schema";
import { Play, SkipForward, Eye, Trophy, Square, Pause, PlayCircle, RefreshCw, UserMinus, Users } from "lucide-react";

export default function HostScreen() {
  const [, navigate] = useLocation();
  const qClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [pin, setPin] = useState("");
  const [phase, setPhase] = useState<GamePhase>("LOBBY");
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState<{ id: string; name: string }[]>([]);
  const [currentQ, setCurrentQ] = useState(-1);
  const [totalQ, setTotalQ] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [timeLimit, setTimeLimit] = useState(30);
  const [loading, setLoading] = useState(false);

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
        setPin(res.pin);
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
          setPin(res.session.pin);
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

    socket.on("game:questionStart", (data) => {
      setPhase("QUESTION");
      setCurrentQ(data.question.index);
      setTotalQ(data.question.totalQuestions || totalQ);
      setAnsweredCount(0);
    });

    socket.on("game:answerUpdate", (data) => {
      setAnsweredCount(data.answeredCount);
    });

    socket.on("game:reveal", () => setPhase("REVEAL"));
    socket.on("game:leaderboard", () => setPhase("LEADERBOARD"));
    socket.on("game:end", () => setPhase("END"));
    socket.on("game:paused", () => setPaused(true));
    socket.on("game:resumed", () => setPaused(false));
    socket.on("game:restarted", (data) => {
      setPhase("LOBBY");
      setCurrentQ(-1);
      setPlayerCount(data.playerCount);
      setPlayers(data.players);
      setPaused(false);
    });

    return () => {
      socket.off("game:playerJoined");
      socket.off("game:playerLeft");
      socket.off("game:questionStart");
      socket.off("game:answerUpdate");
      socket.off("game:reveal");
      socket.off("game:leaderboard");
      socket.off("game:end");
      socket.off("game:paused");
      socket.off("game:resumed");
      socket.off("game:restarted");
    };
  }, [connected, totalQ]);

  const emit = (event: string, extra: any = {}) => {
    getSocket().emit(event, { sessionId, hostKey, ...extra }, () => {});
  };

  const handleStart = () => emit("host:start");
  const handleNext = () => { emit("host:next"); setAnsweredCount(0); };
  const handleReveal = () => emit("host:reveal");
  const handleLeaderboard = () => emit("host:leaderboard");
  const handleEnd = () => emit("host:end");
  const handlePause = () => emit("host:pause");
  const handleResume = () => emit("host:resume");
  const handleRestart = () => emit("host:restart");
  const handleKick = (playerId: string) => emit("host:kick", { playerId });

  const displayUrl = typeof window !== "undefined" ? `${window.location.origin}/display?pin=${pin}` : "";

  if (!connected) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6" data-testid="host-setup">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent mb-2">Host Control Panel</h1>
        <p className="text-muted-foreground mb-8">Create a new quiz session</p>

        <div className="w-full max-w-md space-y-6">
          <div className="bg-card rounded-xl p-6 border border-border/30">
            <p className="text-sm text-muted-foreground mb-2">Questions loaded</p>
            <p className="text-3xl font-bold text-primary">{questions.length}</p>
            <Button variant="secondary" className="mt-3" onClick={() => navigate("/admin")} data-testid="button-manage-questions">
              Manage Questions
            </Button>
          </div>

          <div className="bg-card rounded-xl p-6 border border-border/30">
            <label className="text-sm text-muted-foreground mb-2 block">Time per question (seconds)</label>
            <Input
              type="number"
              value={timeLimit}
              onChange={(e) => setTimeLimit(Math.max(5, Math.min(120, parseInt(e.target.value) || 30)))}
              className="bg-muted"
              min={5}
              max={120}
              data-testid="input-time-limit"
            />
          </div>

          <Button onClick={createSession} disabled={questions.length === 0 || loading} className="w-full h-14 text-lg font-semibold" data-testid="button-create-session">
            {loading ? "Creating..." : "Create Session"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-testid="host-panel">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-primary">Host Panel</h1>
            <p className="text-sm text-muted-foreground">PIN: <span className="text-foreground font-mono font-bold tracking-wider">{pin}</span></p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Phase</p>
            <p className="font-semibold text-primary">{phase}</p>
          </div>
        </div>

        <div className="bg-card rounded-xl p-4 border border-border/30 mb-6">
          <p className="text-sm text-muted-foreground mb-1">Display URL</p>
          <p className="text-xs font-mono text-foreground/80 break-all" data-testid="text-display-url">{displayUrl}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-card rounded-xl p-4 border border-border/30 text-center">
            <Users className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold text-primary" data-testid="text-host-player-count">{playerCount}</p>
            <p className="text-xs text-muted-foreground">Players</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border/30 text-center">
            <p className="text-2xl font-bold text-primary">{currentQ >= 0 ? `${currentQ + 1}/${totalQ}` : "-"}</p>
            <p className="text-xs text-muted-foreground">Question</p>
          </div>
        </div>

        {phase === "QUESTION" && (
          <div className="bg-card rounded-xl p-4 border border-border/30 mb-6">
            <p className="text-sm text-muted-foreground mb-1">Answers received</p>
            <p className="text-xl font-bold text-primary">{answeredCount} / {playerCount}</p>
            <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${playerCount > 0 ? (answeredCount / playerCount) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        <div className="space-y-3 mb-8">
          {phase === "LOBBY" && (
            <>
              <Button onClick={() => { handleStart(); handleNext(); }} className="w-full h-12" disabled={playerCount === 0} data-testid="button-start-game">
                <Play className="w-5 h-5 mr-2" /> Start Game
              </Button>
            </>
          )}

          {phase === "QUESTION" && (
            <>
              {!paused ? (
                <Button onClick={handlePause} variant="secondary" className="w-full h-12" data-testid="button-pause">
                  <Pause className="w-5 h-5 mr-2" /> Pause
                </Button>
              ) : (
                <Button onClick={handleResume} className="w-full h-12" data-testid="button-resume">
                  <PlayCircle className="w-5 h-5 mr-2" /> Resume
                </Button>
              )}
              <Button onClick={handleReveal} className="w-full h-12" data-testid="button-reveal">
                <Eye className="w-5 h-5 mr-2" /> Reveal Answer
              </Button>
            </>
          )}

          {phase === "REVEAL" && (
            <>
              <Button onClick={handleLeaderboard} className="w-full h-12" data-testid="button-show-leaderboard">
                <Trophy className="w-5 h-5 mr-2" /> Show Leaderboard
              </Button>
            </>
          )}

          {phase === "LEADERBOARD" && (
            <>
              <Button onClick={handleNext} className="w-full h-12" data-testid="button-next-question">
                <SkipForward className="w-5 h-5 mr-2" /> Next Question
              </Button>
            </>
          )}

          {(phase === "QUESTION" || phase === "REVEAL" || phase === "LEADERBOARD") && (
            <Button onClick={handleEnd} variant="destructive" className="w-full h-12" data-testid="button-end-game">
              <Square className="w-5 h-5 mr-2" /> End Game
            </Button>
          )}

          {phase === "END" && (
            <Button onClick={handleRestart} variant="secondary" className="w-full h-12" data-testid="button-restart">
              <RefreshCw className="w-5 h-5 mr-2" /> Restart Game
            </Button>
          )}
        </div>

        {players.length > 0 && (
          <div className="bg-card rounded-xl p-4 border border-border/30">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Players</h3>
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
