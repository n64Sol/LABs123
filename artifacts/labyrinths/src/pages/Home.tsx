import { useState } from "react";
import { useListLabyrinths } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, MapPin, Swords, Map as MapIcon, LayoutGrid } from "lucide-react";
import OverworldMap from "@/components/overworld/OverworldMap";

type View = "map" | "list";

export default function Home() {
  const [view, setView] = useState<View>("map");
  const { data: labyrinths, isLoading } = useListLabyrinths({ sort: "trending" });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">Overworld</h1>
          <p className="text-muted-foreground text-lg">
            {view === "map"
              ? "Walk the world, meet other wanderers, and step into a labyrinth."
              : "Browse and explore published labyrinths."}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <button
            onClick={() => setView("map")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === "map"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapIcon className="h-4 w-4" />
            Map
          </button>
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            List
          </button>
        </div>
      </div>

      {view === "map" ? (
        <OverworldMap />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 rounded-xl bg-muted animate-pulse" />
            ))
          ) : (
            labyrinths?.map((lab) => (
              <Link key={lab.id} href={`/labyrinth/${lab.id}`} className="group cursor-pointer">
                <Card className="h-full hover:border-primary/50 hover:shadow-lg transition-all overflow-hidden flex flex-col">
                  <div
                    className="h-32 w-full relative"
                    style={{ backgroundColor: lab.accentColor || 'var(--primary)' }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                      <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                        Lvl {lab.level}
                      </Badge>
                      <div className="flex items-center gap-1 text-yellow-500 font-semibold bg-background/80 px-2 py-1 rounded-full backdrop-blur-sm text-sm">
                        <Star className="w-4 h-4 fill-current" />
                        {lab.ratingAverage.toFixed(1)}
                      </div>
                    </div>
                  </div>

                  <CardHeader className="pt-4 pb-2">
                    <h3 className="font-bold text-xl line-clamp-1 group-hover:text-primary transition-colors">
                      {lab.name}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <img src={lab.ownerAvatarUrl} alt="" className="w-5 h-5 rounded-full" />
                      <span>by {lab.ownerName}</span>
                    </div>
                  </CardHeader>

                  <CardContent className="pb-4 flex-1">
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {lab.description || "A mysterious dungeon waiting to be explored."}
                    </p>
                  </CardContent>

                  <CardFooter className="pt-0 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-4 h-4" />
                      {lab.biome}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Swords className="w-4 h-4" />
                      {lab.runsAllTime} runs
                    </div>
                  </CardFooter>
                </Card>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
