import { Switch, Route } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { BRAND } from "@/brand";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/HomePage";
import DisplayScreen from "@/pages/DisplayScreen";
import PlayerScreen from "@/pages/PlayerScreen";
import HostScreen from "@/pages/HostScreen";
import AdminScreen from "@/pages/AdminScreen";
import WinnersScreen from "@/pages/WinnersScreen";
import AdminGate from "@/components/AdminGate";

function ProtectedHost() {
  return <AdminGate><HostScreen /></AdminGate>;
}

function ProtectedAdmin() {
  return <AdminGate><AdminScreen /></AdminGate>;
}

function ProtectedWinners() {
  return <AdminGate><WinnersScreen /></AdminGate>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/display" component={DisplayScreen} />
      <Route path="/join" component={PlayerScreen} />
      <Route path="/host" component={ProtectedHost} />
      <Route path="/admin" component={ProtectedAdmin} />
      <Route path="/winners" component={ProtectedWinners} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.title = BRAND.name;
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
