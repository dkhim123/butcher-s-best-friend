import { Beef } from "lucide-react";
import { ksh } from "@/lib/format";
import { useSales } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";

export const Header = () => {
  const { sales } = useSales(todayISO());
  const total = sales.reduce((a, s) => a + s.amount, 0);

  return (
    <header className="border-b bg-gradient-surface sticky top-0 z-30 backdrop-blur shadow-soft">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-primary grid place-items-center shadow-elevated">
            <Beef className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mama Choma Butchery</h1>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString("en-KE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Today's Sales
          </p>
          <p className="text-2xl font-bold text-primary">{ksh(total)}</p>
        </div>
      </div>
    </header>
  );
};
