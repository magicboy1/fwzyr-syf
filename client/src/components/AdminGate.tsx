import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Lock, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { login, verifyToken } from "@/lib/auth";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    verifyToken().then((valid) => setAuthed(valid));
  }, []);

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    const result = await login(password);
    setLoading(false);
    if (result.success) {
      setAuthed(true);
    } else {
      setError(result.error || "Incorrect password");
    }
  };

  if (authed === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (authed) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6" dir="ltr" data-testid="admin-gate">
      <Link href="/">
        <Button variant="ghost" size="sm" className="absolute top-4 right-4" data-testid="button-back-home-gate">
          <ArrowRight className="w-4 h-4 ml-1" /> Home
        </Button>
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-gold" />
          </div>
          <h1 className="text-2xl font-bold text-gold">Sign In</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter the password to continue</p>
        </div>

        <div className="bg-card rounded-xl p-6 border border-border/30 space-y-4">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="bg-muted"
              placeholder="••••••••"
              dir="ltr"
              autoFocus
              data-testid="input-admin-password"
            />
          </div>
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-red-400"
              data-testid="text-login-error"
            >
              {error}
            </motion.p>
          )}
          <Button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className="w-full"
            data-testid="button-login"
          >
            {loading ? "Verifying..." : "Enter"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
