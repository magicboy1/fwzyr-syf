import { motion } from "framer-motion";
import { Link } from "wouter";
import { BRAND } from "@/brand";
import { QrCode, Settings, BookOpen, Trophy } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen text-foreground flex flex-col items-center justify-center p-6" dir="ltr" data-testid="home-screen">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <img src={BRAND.logo} alt={BRAND.eventName} className="h-24 mx-auto mb-4 object-contain" data-testid="img-home-logo" />
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          {BRAND.tagline}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <Link href="/host">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer hover:border-gold/50 transition-colors h-full" data-testid="link-host">
            <Settings className="w-8 h-8 mx-auto mb-3 text-gold" />
            <h3 className="font-semibold text-lg mb-1">Game Control</h3>
            <p className="text-sm text-muted-foreground">Run the quiz & open the screen</p>
          </motion.div>
        </Link>

        <Link href="/admin">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer hover:border-gold/50 transition-colors h-full" data-testid="link-admin">
            <BookOpen className="w-8 h-8 mx-auto mb-3 text-gold" />
            <h3 className="font-semibold text-lg mb-1">Questions</h3>
            <p className="text-sm text-muted-foreground">Manage the question bank</p>
          </motion.div>
        </Link>

        <Link href="/winners">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer hover:border-gold/50 transition-colors h-full" data-testid="link-winners">
            <Trophy className="w-8 h-8 mx-auto mb-3 text-gold" />
            <h3 className="font-semibold text-lg mb-1">Winners</h3>
            <p className="text-sm text-muted-foreground">Results & winners by region</p>
          </motion.div>
        </Link>
      </div>

      <p className="text-xs text-muted-foreground mt-8 flex items-center gap-2" data-testid="home-hint">
        <QrCode className="w-4 h-4" /> Players join by scanning the QR code on the main screen.
      </p>
    </div>
  );
}
