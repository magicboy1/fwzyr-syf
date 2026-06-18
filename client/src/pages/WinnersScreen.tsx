import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Trophy, Phone, Square, MapPin, ArrowRight, Download } from "lucide-react";

function downloadWinnersCsv(session: SessionWinners) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["Region", "Rank", "Name", "Phone", "Score"].map(esc).join(",")];
  for (const r of session.regionWinners || []) {
    for (const w of r.winners) {
      rows.push([r.label, w.rank, w.name, w.phone || "", w.score].map(esc).join(","));
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

interface RegionWinnerGroup {
  key: string;
  label: string;
  winnerCount: number;
  winners: { rank: number; name: string; phone: string; score: number }[];
}

interface SessionWinners {
  sessionId: string;
  phase: string;
  playerCount: number;
  regionWinners: RegionWinnerGroup[];
}

export default function WinnersScreen() {
  const queryClient = useQueryClient();
  const { data: sessions = [] } = useQuery<SessionWinners[]>({
    queryKey: ["/api/sessions/winners"],
    refetchInterval: 5000,
  });

  const endGameMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("POST", `/api/sessions/${sessionId}/end`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sessions/winners"] }),
  });

  return (
    <div className="min-h-screen bg-background text-foreground p-6" dir="ltr" data-testid="winners-screen">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
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

        {sessions.length === 0 && (
          <div className="bg-card rounded-xl p-10 border border-border/30 text-center">
            <Trophy className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No games yet. Winners appear here once a game is running or finished.</p>
          </div>
        )}

        <div className="space-y-6">
          {sessions.map((session) => {
            const isLive = session.phase !== "END";
            const hasWinners = (session.regionWinners || []).some((r) => r.winners.length > 0);
            return (
              <div key={session.sessionId} className="bg-card rounded-xl p-4 border border-gold/20">
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground" dir="ltr">{session.sessionId.slice(0, 8)}...</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${session.phase === "END" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
                      {session.phase === "END" ? "Ended" : "Live"} — {session.playerCount} players
                    </span>
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
                                <p className="text-xs text-muted-foreground flex items-center gap-1" dir="ltr"><Phone className="w-3 h-3" /> {w.phone || "—"}</p>
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
          })}
        </div>
      </div>
    </div>
  );
}
