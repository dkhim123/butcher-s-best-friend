import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "@/components/butchery/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Building2,
  Image,
  Loader2,
  Plus,
  Trash2,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { org, branch: activeBranch, refreshSession } = useAuth();

  // ── Business Name ─────────────────────────────────────────────
  const [bizName, setBizName] = useState(org?.name ?? "");
  const [savingName, setSavingName] = useState(false);

  // Keep the input in sync if the org gets refreshed from elsewhere.
  useEffect(() => {
    setBizName(org?.name ?? "");
    setLogoPreview(org?.logo_url ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, org?.name, org?.logo_url]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bizName.trim() || !org) return;
    setSavingName(true);
    const { error } = await supabase
      .from("organisations")
      .update({ name: bizName.trim() })
      .eq("id", org.id);

    if (error) {
      setSavingName(false);
      toast.error(error.message);
      return;
    }

    await refreshSession();
    setSavingName(false);
    toast.success("Business name updated");
  };

  // ── Logo Upload ───────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(org?.logo_url ?? null);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !org) return;

    const maxBytes = 2 * 1024 * 1024; // 2 MB
    if (file.size > maxBytes) {
      toast.error("Logo must be under 2 MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    const ext = file.name.split(".").pop() ?? "png";
    const path = `${org.id}/logo.${ext}`;

    setUploadingLogo(true);
    const { error: uploadErr } = await supabase.storage
      .from("org-logos")
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      setUploadingLogo(false);
      toast.error("Upload failed: " + uploadErr.message);
      return;
    }

    const { data: urlData } = supabase.storage.from("org-logos").getPublicUrl(path);
    // Cache-busted URL stored in the DB so any cached <img> tags pick up the new file.
    const cacheBusted = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from("organisations")
      .update({ logo_url: cacheBusted })
      .eq("id", org.id);

    if (updateErr) {
      setUploadingLogo(false);
      toast.error("Failed to save logo URL: " + updateErr.message);
      return;
    }

    setLogoPreview(cacheBusted);
    await refreshSession();
    setUploadingLogo(false);
    toast.success("Logo updated");
  };

  const handleRemoveLogo = async () => {
    if (!org) return;
    const { error } = await supabase
      .from("organisations")
      .update({ logo_url: null })
      .eq("id", org.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLogoPreview(null);
    await refreshSession();
    toast.success("Logo removed");
  };

  // ── Branches ──────────────────────────────────────────────────
  const [branches, setBranches] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [addingBranch, setAddingBranch] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState<string | null>(null);

  const loadBranches = async () => {
    if (!org) return;
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .eq("org_id", org.id)
      .order("created_at");
    if (error) toast.error(error.message);
    else setBranches(data ?? []);
    setBranchesLoaded(true);
  };

  // Load branches on mount
  useEffect(() => { loadBranches(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranch.trim() || !org) return;
    setAddingBranch(true);
    const { data, error } = await supabase
      .from("branches")
      .insert({ org_id: org.id, name: newBranch.trim() })
      .select()
      .single();

    if (error) {
      setAddingBranch(false);
      toast.error(error.message);
      return;
    }

    setBranches((prev) => [...prev, data]);
    setNewBranch("");
    // If this was the org's first branch, refresh so the session picks it up
    // as the active branch.
    if (branches.length === 0) await refreshSession();
    setAddingBranch(false);
    toast.success(`Branch "${data.name}" added`);
  };

  const handleDeleteBranch = async (branchId: string, name: string) => {
    if (!confirm(`Delete branch "${name}"? All data in this branch will be lost.`)) return;
    setDeletingBranch(branchId);
    const { error } = await supabase
      .from("branches")
      .delete()
      .eq("id", branchId)
      .eq("org_id", org.id);

    if (error) {
      setDeletingBranch(null);
      toast.error(error.message);
      return;
    }

    setBranches((prev) => prev.filter((b) => b.id !== branchId));
    // If the user deleted their own active branch, refresh so the session
    // either picks up another branch or sets branch to null.
    if (activeBranch?.id === branchId) await refreshSession();
    setDeletingBranch(null);
    toast.success(`Branch "${name}" deleted`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 max-w-2xl space-y-6">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        {/* ── Business Name ── */}
        <Card className="p-6 shadow-elevated space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Business Name</h2>
              <p className="text-xs text-muted-foreground">Shown in the header and on receipts</p>
            </div>
          </div>
          <form onSubmit={handleSaveName} className="flex gap-2">
            <Input
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              placeholder="Your Butchery Name"
              required
            />
            <Button type="submit" disabled={savingName} className="shrink-0">
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </form>
        </Card>

        {/* ── Logo ── */}
        <Card className="p-6 shadow-elevated space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <Image className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Business Logo</h2>
              <p className="text-xs text-muted-foreground">Shown in header and printed on receipts. Max 2 MB</p>
            </div>
          </div>

          {logoPreview ? (
            <div className="flex items-center gap-4">
              <img
                src={logoPreview}
                alt="Business logo"
                className="h-20 w-20 rounded-xl object-contain border bg-white"
              />
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingLogo}
                  className="gap-1.5"
                >
                  {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive gap-1.5 block"
                  onClick={handleRemoveLogo}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingLogo}
              className="gap-2"
            >
              {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
              Upload Logo
            </Button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoChange}
          />
        </Card>

        {/* ── Branches ── */}
        <Card className="p-6 shadow-elevated space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
              <GitBranch className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold">Branches</h2>
              <p className="text-xs text-muted-foreground">Each branch is an independent data silo</p>
            </div>
          </div>

          {!branchesLoaded ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {branches.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between border rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-sm">{b.name}</p>
                    {activeBranch?.id === b.id && (
                      <Badge variant="outline" className="text-xs mt-0.5">Active</Badge>
                    )}
                  </div>
                  {branches.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={deletingBranch === b.id}
                      onClick={() => handleDeleteBranch(b.id, b.name)}
                    >
                      {deletingBranch === b.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <Separator />

          <form onSubmit={handleAddBranch} className="flex gap-2">
            <Input
              placeholder="New branch name (e.g. Thika)"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              required
            />
            <Button type="submit" disabled={addingBranch} className="shrink-0 gap-1">
              {addingBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
