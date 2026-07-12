import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Beef, Clock, LogOut } from "lucide-react";

export default function AwaitingApproval() {
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-primary grid place-items-center shadow-elevated">
            <Beef className="h-9 w-9 text-primary-foreground" />
          </div>
          <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/30 border-2 border-amber-300 dark:border-amber-700 grid place-items-center">
            <Clock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Awaiting Role Assignment</h1>
          <p className="text-muted-foreground">
            Hi <span className="font-medium text-foreground">{profile?.full_name ?? profile?.email}</span>
            , your account has been created.
          </p>
          <p className="text-muted-foreground">
            An admin needs to assign you a role (cashier or manager) before you can
            access the system. Please contact your manager.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-left space-y-1">
          <p className="font-medium">Account details</p>
          <p className="text-muted-foreground">Email: {profile?.email}</p>
          <p className="text-muted-foreground">
            Status: <span className="text-amber-600 font-medium capitalize">{profile?.role}</span>
          </p>
        </div>

        <Button variant="outline" onClick={signOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
