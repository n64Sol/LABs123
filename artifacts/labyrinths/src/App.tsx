import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { useGetCurrentPlayer } from "@workspace/api-client-react";

import Shell from "@/components/layout/Shell";
import Connect from "@/pages/Connect";
import Home from "@/pages/Home";
import LabyrinthDetail from "@/pages/LabyrinthDetail";
import Run from "@/pages/Run";
import Duel from "@/pages/Duel";
import Forge from "@/pages/Forge";
import Dungeon from "@/pages/Dungeon";
import Economy from "@/pages/Economy";
import Loadout from "@/pages/Loadout";
import Marketplace from "@/pages/Marketplace";
import Codex from "@/pages/Codex";
import InteriorScene from "@/components/overworld/InteriorScene";
import Welcome from "@/pages/Welcome";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: player, isLoading, error } = useGetCurrentPlayer();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (error || !player) {
      setLocation("/connect");
    } else if (player.ownedLabyrinthId == null && location !== "/welcome") {
      // New wanderers must claim a homeland (which anchors their land plot)
      // before entering the overworld.
      setLocation("/welcome");
    }
  }, [isLoading, error, player, setLocation, location]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !player) return null;

  return <>{children}</>;
}

function Shelled({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/connect" component={Connect} />
      <Route path="/welcome"><AuthGuard><Welcome /></AuthGuard></Route>
      <Route path="/"><Shelled><Home /></Shelled></Route>
      <Route path="/labyrinth/:id"><Shelled><LabyrinthDetail /></Shelled></Route>
      <Route path="/run/:id"><Shelled><Run /></Shelled></Route>
      <Route path="/duel/:id"><Shelled><Duel /></Shelled></Route>
      <Route path="/forge"><Shelled><Forge /></Shelled></Route>
      <Route path="/dungeon"><Shelled><Dungeon /></Shelled></Route>
      <Route path="/economy"><Shelled><Economy /></Shelled></Route>
      <Route path="/loadout"><Shelled><Loadout /></Shelled></Route>
      <Route path="/marketplace"><Shelled><Marketplace /></Shelled></Route>
      <Route path="/codex"><Shelled><Codex /></Shelled></Route>
      <Route path="/town/:id"><Shelled><InteriorScene /></Shelled></Route>
      <Route><NotFound /></Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <SonnerToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
