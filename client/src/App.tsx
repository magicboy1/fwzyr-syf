import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/HomePage";
import DisplayScreen from "@/pages/DisplayScreen";
import PlayerScreen from "@/pages/PlayerScreen";
import HostScreen from "@/pages/HostScreen";
import AdminScreen from "@/pages/AdminScreen";

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/display" component={DisplayScreen} />
      <Route path="/join" component={PlayerScreen} />
      <Route path="/host" component={HostScreen} />
      <Route path="/admin" component={AdminScreen} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
