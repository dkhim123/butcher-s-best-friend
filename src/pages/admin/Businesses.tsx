import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Hotel,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Power,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

interface OrgRow {
  id: string;
  name: string;
  tagline: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
}

/**
 * Businesses — the platform super-admin console.
 *
 * The super_admin is the only account that can onboard a business. Each
 * business gets its own org + first admin + Main Branch, and from then on
 * runs completely isolated from every other business on the platform.
 */
export default function Businesses() {
  const { profile, role, registerBusiness, setBusinessActive, resetPassword, signOut } = useAuth();

  // Reset any user's password (super admin can reset across all businesses).
  const [resetEmail, setResetEmail] = useState("");
  const [resetPwd, setResetPwd] = useState("");
  const [resetting, setResetting] = useState(false);
  const doReset = async () => {
    if (!resetEmail.trim()) return toast.error("Enter the user's email");
    if (resetPwd.length < 8) return toast.error("Password must be at least 8 characters");
    setResetting(true);
    const { error } = await resetPassword(resetEmail.trim(), resetPwd);
    setResetting(false);
    if (error) return toast.error(error);
    toast.success(`Password reset for ${resetEmail.trim()}`);
    setResetEmail("");
    setResetPwd("");
  };

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Register form
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [phone, setPhone] = useState("");
  const [mpesaPaybill, setMpesaPaybill] = useState("");
  const [mpesaTill, setMpesaTill] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchOrgs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("organisations")
      .select("id, name, tagline, phone, active, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error("Failed to load businesses: " + error.message);
    else setOrgs((data ?? []) as OrgRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (role === "super_admin") void fetchOrgs();
  }, [role]);

  // Only the super_admin belongs here. Everyone else goes to their app.
  if (role && role !== "super_admin") return <Navigate to="/" replace />;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) return toast.error("Enter the business name");
    if (!fullName.trim()) return toast.error("Enter the admin's full name");
    if (!email.trim()) return toast.error("Enter the admin's email");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");

    setCreating(true);
    const { error } = await registerBusiness({
      email,
      password,
      fullName,
      businessName,
      tagline,
      phone,
      mpesaPaybill,
      mpesaTill,
    });
    setCreating(false);
    if (error) return toast.error(error);

    toast.success(`${businessName.trim()} created`);
    setBusinessName("");
    setTagline("");
    setPhone("");
    setMpesaPaybill("");
    setMpesaTill("");
    setFullName("");
    setEmail("");
    setPassword("");
    void fetchOrgs();
  };

  const toggleActive = async (org: OrgRow) => {
    setBusyId(org.id);
    const { error } = await setBusinessActive(org.id, !org.active);
    setBusyId(null);
    if (error) return toast.error(error);
    toast.success(org.active ? `${org.name} suspended` : `${org.name} restored`);
    setOrgs((prev) =>
      prev.map((o) => (o.id === org.id ? { ...o, active: !o.active } : o)),
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-gradient-surface sticky top-0 z-30 backdrop-blur shadow-soft">
        <div className="container flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-primary grid place-items-center shadow-elevated">
              <Hotel className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Decent microsystem</h1>
              <p className="text-xs text-muted-foreground">
                {profile?.full_name ?? "Super Admin"} · manage businesses
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Register a business */}
        <Card className="p-6 shadow-elevated">
          <div className="flex items-center gap-2 mb-5">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <Plus className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Register a Business</h2>
              <p className="text-xs text-muted-foreground">
                Creates the business and its first admin account
              </p>
            </div>
          </div>

          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                placeholder="Tavern Inn Shanzu"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tagline (on receipts)</Label>
              <Input
                placeholder="Restaurant · Bar · Rooms"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone (on receipts)</Label>
              <Input
                placeholder="0700 000 000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>M-Pesa Paybill (optional)</Label>
              <Input
                placeholder="e.g. 400200"
                value={mpesaPaybill}
                onChange={(e) => setMpesaPaybill(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>M-Pesa Till / Buy Goods (optional)</Label>
              <Input
                placeholder="e.g. 5200000"
                value={mpesaTill}
                onChange={(e) => setMpesaTill(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin Full Name</Label>
              <Input
                placeholder="Jane Wanjiru"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin Email</Label>
              <Input
                type="email"
                placeholder="admin@taverninn.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin Password</Label>
              <PasswordInput
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Business
              </Button>
            </div>
          </form>
        </Card>

        {/* Reset a user's password */}
        <Card className="p-6 shadow-elevated">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <KeyRound className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Reset a User's Password</h2>
              <p className="text-xs text-muted-foreground">
                For any user across all businesses — they can sign in immediately
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="user@business.co.ke"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />
            <PasswordInput
              placeholder="New password (min 8)"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              minLength={8}
            />
            <Button onClick={doReset} disabled={resetting} className="gap-1.5 shrink-0">
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Reset
            </Button>
          </div>
        </Card>

        {/* Businesses list */}
        <Card className="p-6 shadow-elevated">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
                <Building2 className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-semibold">Businesses</h2>
                <p className="text-xs text-muted-foreground">
                  {orgs.length} registered
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchOrgs} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No businesses yet. Register your first one above.
            </p>
          ) : (
            <div className="space-y-3">
              {orgs.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border rounded-lg p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{o.name}</p>
                      <Badge
                        variant="outline"
                        className={
                          o.active
                            ? "border-green-200 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            : "border-amber-200 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        }
                      >
                        {o.active ? "Active" : "Suspended"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {o.tagline ?? "—"}
                      {o.phone ? ` · ${o.phone}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Since{" "}
                      {new Date(o.created_at).toLocaleDateString("en-KE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <Button
                    variant={o.active ? "outline" : "default"}
                    size="sm"
                    className="gap-1.5 shrink-0"
                    disabled={busyId === o.id}
                    onClick={() => toggleActive(o)}
                  >
                    {busyId === o.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Power className="h-3.5 w-3.5" />
                    )}
                    {o.active ? "Suspend" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Suspending a business blocks all of its staff from signing in. Their
            data is preserved and returns the moment you restore them.
          </p>
        </Card>
      </main>
    </div>
  );
}
