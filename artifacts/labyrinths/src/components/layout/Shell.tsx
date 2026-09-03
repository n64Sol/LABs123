import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentPlayer, useGetBalances, useLogout, getGetCurrentPlayerQueryKey } from "@workspace/api-client-react";
import { LogOut, Compass, Map, Shield, Wallet, CircleDollarSign, Hammer, Store, DollarSign, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { fmtUsdc } from "@/lib/game";

interface ShellProps {
  children: ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const { data: player } = useGetCurrentPlayer();
  const { data: balances } = useGetBalances();
  const logout = useLogout();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const navItems = [
    { href: "/", label: "Overworld", icon: Compass },
    { href: "/dungeon", label: "My Labyrinth", icon: Map },
    { href: "/loadout", label: "Loadout", icon: Shield },
    { href: "/codex", label: "Codex", icon: BookOpen },
    { href: "/forge", label: "Forge", icon: Hammer },
    { href: "/marketplace", label: "Marketplace", icon: Store },
    { href: "/economy", label: "Economy", icon: Wallet },
  ];

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCurrentPlayerQueryKey() });
        setLocation("/connect");
      }
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <nav className="w-full md:w-64 bg-card border-b md:border-b-0 md:border-r border-border p-4 flex flex-col">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
            L
          </div>
          <span className="text-xl font-bold tracking-wider uppercase text-primary">Labyrinths</span>
        </div>

        <div className="space-y-1 flex-1">
          {navItems.map((item) => {
            const active = item.href === "/" ? location === "/" : location.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                  active
                    ? "bg-primary/15 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {player && (
          <div className="mt-auto pt-6 border-t border-border">
            <div className="flex items-center gap-3 mb-4">
              <img src={player.avatarUrl} alt={player.displayName} className="w-10 h-10 rounded-full border-2 border-primary/20" />
              <div className="flex flex-col">
                <span className="font-semibold text-sm">{player.displayName}</span>
                {balances && (
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className="flex items-center gap-1 text-primary">
                      <CircleDollarSign className="w-3 h-3" />
                      {balances.gold}
                    </span>
                    <span className="flex items-center gap-0.5 text-emerald-500">
                      <DollarSign className="w-3 h-3" />
                      {fmtUsdc(balances.usdc).replace(/^\$/, "")}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
              Disconnect
            </Button>
          </div>
        )}
      </nav>

      <main className="flex-1 p-6 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
