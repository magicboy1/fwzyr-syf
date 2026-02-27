import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import logoUrl from "@assets/logo_1772218489356.png";
import { Monitor, Smartphone, Settings, BookOpen } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6" dir="rtl" data-testid="home-screen">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <img src={logoUrl} alt="السحور السنوي" className="h-16 mx-auto mb-6 object-contain opacity-90" data-testid="img-home-logo" />
        <h1 className="text-5xl font-bold text-[#CDB58B] mb-3">
          فوازير سيف
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          المسابقة التفاعلية المباشرة لحفل السحور السنوي
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <Link href="/join">
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-join">
            <Smartphone className="w-8 h-8 mx-auto mb-3 text-[#CDB58B]" />
            <h3 className="font-semibold text-lg mb-1">انضم للعبة</h3>
            <p className="text-sm text-muted-foreground">العب من جوالك</p>
          </motion.div>
        </Link>

        <Link href="/host">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-host">
            <Settings className="w-8 h-8 mx-auto mb-3 text-[#CDB58B]" />
            <h3 className="font-semibold text-lg mb-1">إدارة اللعبة</h3>
            <p className="text-sm text-muted-foreground">تحكم بالمسابقة</p>
          </motion.div>
        </Link>

        <Link href="/admin">
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="bg-card rounded-xl p-6 border border-border/30 text-center cursor-pointer transition-colors" data-testid="link-admin">
            <BookOpen className="w-8 h-8 mx-auto mb-3 text-[#CDB58B]" />
            <h3 className="font-semibold text-lg mb-1">الأسئلة</h3>
            <p className="text-sm text-muted-foreground">إدارة بنك الأسئلة</p>
          </motion.div>
        </Link>

        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="bg-card rounded-xl p-6 border border-border/30 text-center opacity-70" data-testid="link-display-info">
          <Monitor className="w-8 h-8 mx-auto mb-3 text-[#CDB58B]" />
          <h3 className="font-semibold text-lg mb-1">الشاشة الرئيسية</h3>
          <p className="text-sm text-muted-foreground">تفتح تلقائياً من المضيف</p>
        </motion.div>
      </div>
    </div>
  );
}
