import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background" dir="rtl">
      <Card className="w-full max-w-md mx-4 bg-card border-border/30">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-10 w-10 text-[#CDB58B] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">الصفحة غير موجودة</h1>
          <p className="text-sm text-muted-foreground mb-6">الصفحة التي تبحث عنها غير موجودة</p>
          <Link href="/">
            <Button data-testid="button-go-home">الرجوع للرئيسية</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
