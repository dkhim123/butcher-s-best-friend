import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Database, UserPermissions } from "@/lib/database.types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, Loader2, RefreshCw, UserPlus, Trash2, ChevronDown, ChevronUp, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ACTIVE_DEPARTMENTS, Department, DEPARTMENT_LABELS } from "@/lib/butchery-types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Branch = Database["public"]["Tables"]["branches"]["Row"];
type Role = Profile["role"];

const PERMISSION_LABELS: { key: keyof UserPermissions; label: string; desc: string }[] = [
  { key: "can_create_purchase_orders", label: "Create Purchase Orders", desc: "Can raise new purchase orders" },
  { key: "can_receive_purchases",      label: "Receive Purchases",       desc: "Can mark POs as received" },
  { key: "can_view_reports",           label: "View Reports",            desc: "Can see daily reports" },
  { key: "can_view_transactions",      label: "View Full Transactions",  desc: "Can see all branch transactions, not just own" },
  { key: "can_view_products",          label: "View Products",           desc: "Can browse the products tab" },
  { key: "can_view_stock",             label: "View Stock",              desc: "Can see opening stock entries" },
  { key: "can_manage_credit",          label: "Manage Credit",           desc: "Can mark credit sales as paid" },
];

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  pending: "Suspended",
};

const ROLE_COLORS: Record<Role, string> = {
  super_admin: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200",
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200",
  manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200",
  cashier: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200",
};

export const UserManagement = () => {
  const { profile: currentUser, org, createUser, updatePermissions, resetPassword } = useAuth();
  const orgId = org?.id ?? "";

  const [users, setUsers] = useState<Profile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedPerms, setExpandedPerms] = useState<string | null>(null);

  // Password reset dialog
  const [resetUser, setResetUser] = useState<Profile | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetting, setResetting] = useState(false);

  const doReset = async () => {
    if (!resetUser) return;
    if (resetPwd.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setResetting(true);
    const { error } = await resetPassword(resetUser.email, resetPwd);
    setResetting(false);
    if (error) { toast.error(error); return; }
    toast.success(`Password reset for ${resetUser.full_name ?? resetUser.email}`);
    setResetUser(null);
    setResetPwd("");
  };

  // Create form
  const [creating, setCreating] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "manager" | "cashier">("cashier");
  const [newBranchId, setNewBranchId] = useState<string>("none");
  // Which departments a new cashier may work in. Restaurant by default.
  const [newDepartments, setNewDepartments] = useState<Department[]>(["restaurant"]);

  const toggleNewDepartment = (d: Department, on: boolean) =>
    setNewDepartments((prev) =>
      on ? Array.from(new Set([...prev, d])) : prev.filter((x) => x !== d),
    );

  const fetchData = async () => {
    if (!orgId) return;
    setLoading(true);
    const [profilesRes, branchesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, role, org_id, branch_id, permissions, created_at")
        .eq("org_id", orgId)
        .order("created_at"),
      supabase.from("branches").select("*").eq("org_id", orgId).order("created_at"),
    ]);
    if (profilesRes.error) toast.error("Failed to load users: " + profilesRes.error.message);
    else setUsers(profilesRes.data ?? []);
    if (branchesRes.error) toast.error("Failed to load branches: " + branchesRes.error.message);
    else setBranches(branchesRes.data ?? []);
    setLoading(false);
  };

  const chId = useRef(`profiles-mgmt-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    fetchData();
    if (!orgId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim()) { toast.error("Enter full name"); return; }
    if (!newEmail.trim()) { toast.error("Enter email"); return; }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if ((newRole === "cashier" || newRole === "manager") && newBranchId === "none") {
      toast.error("Cashiers and managers must be assigned to a branch");
      return;
    }
    if (newRole === "cashier" && newDepartments.length === 0) {
      toast.error("Pick at least one department for the cashier");
      return;
    }

    setCreating(true);
    const { error } = await createUser({
      email: newEmail,
      password: newPassword,
      fullName: newFullName.trim(),
      role: newRole,
      branchId: newBranchId === "none" ? null : newBranchId,
      // Only cashiers are department-scoped; managers/admins see everything.
      permissions: newRole === "cashier" ? { departments: newDepartments } : {},
    });
    setCreating(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success(`${ROLE_LABELS[newRole]} account created for ${newFullName.trim()}`);
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("cashier");
      setNewBranchId("none");
      setNewDepartments(["restaurant"]);
      fetchData();
    }
  };

  const handleRoleChange = async (userId: string, role: Role) => {
    setSaving(userId);
    // Always scope by org_id so one business cannot change another's staff.
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId)
      .eq("org_id", orgId);
    setSaving(null);
    if (error) {
      toast.error("Failed to update role: " + error.message);
    } else {
      toast.success("Role updated");
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    }
  };

  const handleDepartmentToggle = async (user: Profile, dept: Department, on: boolean) => {
    const current = user.permissions.departments ?? [];
    const next = on
      ? Array.from(new Set([...current, dept]))
      : current.filter((d) => d !== dept);
    const updated: UserPermissions = { ...user.permissions, departments: next };
    setSaving(user.id);
    const { error } = await updatePermissions(user.id, updated);
    setSaving(null);
    if (error) {
      toast.error("Failed to update departments: " + error);
    } else {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, permissions: updated } : u)));
    }
  };

  const handlePermissionToggle = async (user: Profile, key: keyof UserPermissions, value: boolean) => {
    const updated: UserPermissions = { ...user.permissions, [key]: value };
    setSaving(user.id);
    const { error } = await updatePermissions(user.id, updated);
    setSaving(null);
    if (error) {
      toast.error("Failed to update permissions: " + error);
    } else {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, permissions: updated } : u)));
    }
  };

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    setSaving(userId);
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId)
      .eq("org_id", orgId);
    setSaving(null);
    if (error) {
      toast.error("Failed to delete user: " + error.message);
    } else {
      toast.success("User deleted");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    }
  };

  const getBranchName = (branchId: string | null) => {
    if (!branchId) return "All branches";
    return branches.find((b) => b.id === branchId)?.name ?? "Unknown branch";
  };

  const assignableRoles: Role[] = ["admin", "manager", "cashier", "pending"];

  return (
    <div className="space-y-6">
      {/* Create Staff Account */}
      <Card className="p-6 shadow-elevated">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
            <UserPlus className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Create Staff Account</h2>
            <p className="text-xs text-muted-foreground">
              Staff are only for <strong>{org?.name ?? "your business"}</strong> — not shared with other businesses
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-fullname">Full Name</Label>
            <Input
              id="new-fullname"
              placeholder="Jane Wanjiru"
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              placeholder="jane@business.co.ke"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">Password</Label>
            <PasswordInput
              id="new-password"
              placeholder="Min 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as typeof newRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier — POS only</SelectItem>
                <SelectItem value="manager">Manager — products, stock, reports</SelectItem>
                <SelectItem value="admin">Admin — full access</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Branch Assignment</Label>
            <Select value={newBranchId} onValueChange={setNewBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No branch (admin only)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {newRole === "cashier" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Departments this cashier works in</Label>
              <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3">
                {ACTIVE_DEPARTMENTS.map((d) => (
                  <label key={d} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={newDepartments.includes(d)}
                      onCheckedChange={(c) => toggleNewDepartment(d, !!c)}
                    />
                    {DEPARTMENT_LABELS[d]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                A Bar cashier only sees Bar products; a Restaurant cashier only sees food.
              </p>
            </div>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" disabled={creating} className="gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create Account
            </Button>
          </div>
        </form>
      </Card>

      {/* Staff List */}
      <Card className="p-6 shadow-elevated">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <Users className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Staff Accounts</h2>
              <p className="text-xs text-muted-foreground">Manage roles and permissions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No users found.</p>
        ) : (
          <div className="space-y-3">
            {users.map((u) => {
              const isCurrentUser = u.id === currentUser?.id;
              const isCashier = u.role === "cashier";
              const showPerms = expandedPerms === u.id;

              return (
                <div key={u.id} className="border rounded-lg overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {u.full_name ?? "—"}
                        {isCurrentUser && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {getBranchName(u.branch_id)} ·{" "}
                        Joined {new Date(u.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={`${ROLE_COLORS[u.role]} border text-xs font-medium`} variant="outline">
                        {ROLE_LABELS[u.role]}
                      </Badge>

                      {!isCurrentUser && (
                        <>
                          <Select
                            value={u.role}
                            onValueChange={(v) => handleRoleChange(u.id, v as Role)}
                            disabled={saving === u.id}
                          >
                            <SelectTrigger className="w-28 h-8 text-xs">
                              {saving === u.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <SelectValue />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {assignableRoles.map((r) => (
                                <SelectItem key={r} value={r} className="text-xs">{ROLE_LABELS[r]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {isCashier && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs gap-1"
                              onClick={() => setExpandedPerms(showPerms ? null : u.id)}
                            >
                              Perms
                              {showPerms ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Reset password"
                            onClick={() => { setResetUser(u); setResetPwd(""); }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={saving === u.id}
                            onClick={() => deleteUser(u.id, u.full_name ?? u.email ?? "")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isCashier && showPerms && (
                    <div className="border-t bg-muted/30 p-4 space-y-4">
                      <div>
                        <p className="text-sm font-medium mb-2">Departments</p>
                        <div className="flex flex-wrap gap-4">
                          {ACTIVE_DEPARTMENTS.map((d) => (
                            <label key={d} className="flex items-center gap-2 cursor-pointer text-sm">
                              <Checkbox
                                checked={(u.permissions.departments ?? ["restaurant"]).includes(d)}
                                disabled={saving === u.id}
                                onCheckedChange={(c) => handleDepartmentToggle(u, d, !!c)}
                              />
                              {DEPARTMENT_LABELS[d]}
                            </label>
                          ))}
                        </div>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {PERMISSION_LABELS.map(({ key, label, desc }) => (
                        <label
                          key={key}
                          className="flex items-start gap-2.5 cursor-pointer group"
                        >
                          <Checkbox
                            checked={!!u.permissions[key]}
                            disabled={saving === u.id}
                            onCheckedChange={(checked) =>
                              handlePermissionToggle(u, key, !!checked)
                            }
                            className="mt-0.5"
                          />
                          <div>
                            <p className="text-sm font-medium group-hover:text-primary transition-colors">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                        </label>
                      ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Admin</strong> — full access + user management + all reports + settings</p>
          <p><strong>Manager</strong> — POS, products, stock, purchases, reports</p>
          <p><strong>Cashier</strong> — POS only, extra access via permission toggles</p>
          <p><strong>Suspended</strong> — account disabled, cannot sign in</p>
        </div>
      </Card>

      {/* Reset password dialog */}
      <Dialog open={!!resetUser} onOpenChange={(o) => !o && setResetUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            Set a new password for{" "}
            <strong>{resetUser?.full_name ?? resetUser?.email}</strong>. Tell it to
            them — they can sign in immediately and change it later.
          </p>
          <div className="space-y-1.5 mt-2">
            <Label>New password</Label>
            <PasswordInput
              placeholder="Min 8 characters"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              minLength={8}
              onKeyDown={(e) => { if (e.key === "Enter") void doReset(); }}
            />
          </div>
          <Button onClick={doReset} disabled={resetting} className="w-full mt-2">
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset password"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
