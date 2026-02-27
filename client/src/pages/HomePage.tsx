import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import logoUrl from "@assets/logo_1772218489356.png";
import { Monitor, Smartphone, Settings, BookOpen } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6" data-testid="home-screen">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <img src={logoUrl} alt="Annual Suhoor" className="h-16 mx-auto mb-6 object-contain opacity-90" data-testid="img-home-logo" />
        <h1 className="text-5xl font-bold bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent mb-3">
          فوازير سيف
        </h1>
        <p className="text-xl text-muted-foreground">Fawazeer Seif</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Live interactive quiz for the Annual Suhoor event
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <Link href="/join">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-join">
            <Smartphone className="w-8 h-8 mx-auto mb-3 text-primary" />
            <h3 className="font-semibold text-lg mb-1">Join Game</h3>
            <p className="text-sm text-muted-foreground">Play on your phone</p>
          </motion.div>
        </Link>

        <Link href="/host">
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-host">
            <Settings className="w-8 h-8 mx-auto mb-3 text-primary" />
            <h3 className="font-semibold text-lg mb-1">Host Game</h3>
            <p className="text-sm text-muted-foreground">Control the quiz</p>
          </motion.div>
        </Link>

        <Link href="/admin">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-admin">
            <BookOpen className="w-8 h-8 mx-auto mb-3 text-primary" />
            <h3 className="font-semibold text-lg mb-1">Questions</h3>
            <p className="text-sm text-muted-foreground">Manage question bank</p>
          </motion.div>
        </Link>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="bg-card rounded-xl p-6 border border-border/30 text-center opacity-70" data-testid="link-display-info">
          <Monitor className="w-8 h-8 mx-auto mb-3 text-primary" />
          <h3 className="font-semibold text-lg mb-1">Big Screen</h3>
          <p className="text-sm text-muted-foreground">Auto-opens from host</p>
        </motion.div>
      </div>
    </div>
  );
}
