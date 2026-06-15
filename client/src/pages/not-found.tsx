import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background" dir="ltr">
      <Card className="w-full max-w-md mx-4 bg-card border-border/30">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-10 w-10 text-gold mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Page Not Found</h1>
          <p className="text-sm text-muted-foreground mb-6">The page you are looking for does not exist</p>
          <Link href="/">
            <Button data-testid="button-go-home">Back to Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
