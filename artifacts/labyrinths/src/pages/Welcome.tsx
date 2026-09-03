import { useState } from "react";
import { useLocation } from "wouter";
import { useClaimLabyrinth, getGetCurrentPlayerQueryKey, getGetMyLabyrinthQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BIOMES } from "@/lib/game";
import { Sparkles, MapPin } from "lucide-react";
import { toast } from "sonner";

/**
 * First-run onboarding: a new wanderer chooses a biome for their homeland. The
 * choice claims their labyrinth, which anchors a permanent land plot in that
 * biome's territory — they spawn into the world right next to their own
 * entrance.
 */
export default function Welcome() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const claim = useClaimLabyrinth();
  const [selBiome, setSelBiome] = useState("verdant_grove");
  const [name, setName] = useState("");

  const handleClaim = async () => {
    try {
      await claim.mutateAsync({ data: { name: name.trim() || undefined, biome: selBiome } });
      await qc.invalidateQueries({ queryKey: getGetCurrentPlayerQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMyLabyrinthQueryKey() });
      toast.success("Your homeland awaits!");
      setLocation("/");
    } catch {
      toast.error("Could not stake your claim. Please try again.");
    }
  };

  const biomeKeys = Object.keys(BIOMES);

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/15">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Choose Your Homeland</h1>
          <p className="mt-2 text-muted-foreground">
            Every wanderer claims a corner of the overworld. Pick a biome — your labyrinth will
            rise there, and you'll begin your journey at its gate.
          </p>
        </div>

        <div className="mb-6">
          <Label className="mb-1.5 block">Name your labyrinth</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Gilded Descent"
            maxLength={60}
          />
        </div>

        <Label className="mb-2 block">Pick your biome</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {biomeKeys.map((key) => {
            const v = BIOMES[key]!;
            const selected = selBiome === key;
            return (
              <button
                key={key}
                onClick={() => setSelBiome(key)}
                className={`group relative overflow-hidden rounded-2xl border-2 p-4 text-left transition-all ${
                  selected ? "border-primary shadow-lg" : "border-border hover:border-primary/40"
                }`}
              >
                <div className="absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50" style={{ background: v.bg }} />
                <div className="relative">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: v.accent }} />
                    <span className="font-bold">{v.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {selected ? "Your homeland" : "Claim this land"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <Button size="lg" className="shadow-lg" disabled={claim.isPending} onClick={handleClaim}>
            {claim.isPending ? "Staking your claim…" : "Enter the Overworld"}
          </Button>
        </div>
      </div>
    </div>
  );
}
