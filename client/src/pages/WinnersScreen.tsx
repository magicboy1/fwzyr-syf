import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Trophy, Mail, Square, MapPin, ArrowRight, Download, Radio, History, Trash2 } from "lucide-react";

function downloadWinnersCsv(session: SessionWinners) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["Region", "Rank", "Name", "Email", "Score"].map(esc).join(",")];
  for (const r of session.regionWinners || []) {
    for (const w of r.winners) {
      rows.push([r.label, w.rank, w.name, w.email || "", w.score].map(esc).join(","));
    }
  }
  // BOM so Excel reads UTF-8 correctly
  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aljeel-winners-${session.sessionId.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatWhen(ts?: number | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

interface RegionWinnerGroup {
  key: string;
  label: string;
  winnerCount: number;
  winners: { rank: number; name: string; email: string; score: number }[];
}

interface SessionWinners {
  sessionId: string;
  phase: string;
  playerCount: number;
  createdAt?: number;
  endedAt?: number | null;
  regionWinners: RegionWinnerGroup[];
}

export default function WinnersScreen() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"active" | "history">("active");
  const { data: sessions = [] } = useQuery<SessionWinners[]>({
    queryKey: ["/api/sessions/winners"],
    refetchInterval: 5000,
  });

  const endGameMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("POST", `/api/sessions/${sessionId}/end`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sessions/winners"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("DELETE", `/api/sessions/${sessionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sessions/winners"] }),
  });

  const active = sessions.filter((s) => s.phase !== "END");
  const history = sessions
    .filter((s) => s.phase === "END")
    .sort((a, b) => (b.endedAt ?? b.createdAt ?? 0) - (a.endedAt ?? a.createdAt ?? 0));
  const shown = tab === "active" ? active : history;

  function renderSession(session: SessionWinners) {
    const isLive = session.phase !== "END";
    const hasWinners = (session.regionWinners || []).some((r) => r.winners.length > 0);
    return (
      <div key={session.sessionId} className="bg-card rounded-xl p-4 border border-gold/20">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground" dir="ltr">{session.sessionId.slice(0, 8)}...</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${session.phase === "END" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
              {session.phase === "END" ? "Ended" : "Live"} — {session.playerCount} players
            </span>
            {session.phase === "END" && session.endedAt && (
              <span className="text-xs text-muted-foreground" dir="ltr">{formatWhen(session.endedAt)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasWinners && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => downloadWinnersCsv(session)}
                data-testid={`button-download-csv-${session.sessionId.slice(0, 8)}`}
              >
                <Download className="w-4 h-4 mr-1" /> CSV
              </Button>
            )}
            {isLive && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { if (confirm("End this game now and show winners?")) endGameMutation.mutate(session.sessionId); }}
                disabled={endGameMutation.isPending}
                data-testid={`button-end-game-${session.sessionId.slice(0, 8)}`}
              >
                <Square className="w-4 h-4 mr-1" /> End Game
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-red-400"
              onClick={() => { if (confirm("Delete this session permanently? This removes it from the list and cannot be undone.")) deleteMutation.mutate(session.sessionId); }}
              disabled={deleteMutation.isPending}
              title="Delete session"
              data-testid={`button-delete-${session.sessionId.slice(0, 8)}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {!hasWinners ? (
          <p className="text-sm text-muted-foreground py-2">
            {isLive ? "Game in progress — end it to see the winners." : "No winners recorded."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(session.regionWinners || []).map((r) => (
              <div key={r.key} className="bg-muted/20 rounded-xl border border-border/30 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gold/10 border-b border-gold/20">
                  <span className="font-bold text-gold flex items-center gap-1"><MapPin className="w-4 h-4" /> {r.label}</span>
                  <span className="text-xs text-gold-accent font-semibold">{r.winners.length}/{r.winnerCount}</span>
                </div>
                <div className="p-2 space-y-1">
                  {r.winners.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No winners</p>}
                  {r.winners.map((w) => (
                    <div key={w.rank} className="flex items-center gap-2 px-2 py-1.5 rounded-lg odd:bg-white/[0.03]" data-testid={`winner-${r.key}-${w.rank}`}>
                      <span className={`w-6 text-center font-bold text-sm ${w.rank <= 3 ? "text-gold-accent" : "text-muted-foreground"}`} dir="ltr">{w.rank}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" dir="auto">{w.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate" dir="ltr"><Mail className="w-3 h-3 shrink-0" /> {w.email || "—"}</p>
                      </div>
                      <span className="font-bold text-gold text-sm tabular-nums" dir="ltr">{w.score.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground p-6" dir="ltr" data-testid="winners-screen">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home"><ArrowRight className="w-5 h-5" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gold flex items-center gap-2"><Trophy className="w-6 h-6" /> Winners</h1>
            <p className="text-sm text-muted-foreground">Winners by region — Riyadh 20, Jeddah 15, Al Khobar 10</p>
          </div>
          <Link href="/host">
            <Button variant="secondary" size="sm" data-testid="button-to-host">Host Panel</Button>
          </Link>
        </div>

        {/* Tabs: Active game vs History */}
        <div className="flex items-center gap-2 mb-6">
          <Button
            variant={tab === "active" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTab("active")}
            data-testid="tab-active"
          >
            <Radio className="w-4 h-4 mr-1" /> Active game{active.length > 0 ? ` (${active.length})` : ""}
          </Button>
          <Button
            variant={tab === "history" ? "default" : "secondary"}
            size="sm"
            onClick={() => setTab("history")}
            data-testid="tab-history"
          >
            <History className="w-4 h-4 mr-1" /> History{history.length > 0 ? ` (${history.length})` : ""}
          </Button>
        </div>

        {shown.length === 0 && (
          <div className="bg-card rounded-xl p-10 border border-border/30 text-center">
            <Trophy className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">
              {tab === "active"
                ? (history.length > 0
                    ? "No active game right now. Check the History tab for finished games."
                    : "No game running. Start one from the Host panel.")
                : "No finished games yet. They appear here once a game ends."}
            </p>
          </div>
        )}

        <div className="space-y-6">
          {shown.map(renderSession)}
        </div>
      </div>
    </div>
  );
}
