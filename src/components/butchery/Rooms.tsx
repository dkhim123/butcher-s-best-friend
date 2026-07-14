import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BedDouble, Plus, Trash2, LogIn, LogOut, Wrench, Settings2, DoorOpen, Printer } from "lucide-react";
import {
  useBookings, useRooms, useRoomTypes, Room, Booking,
} from "@/lib/butchery-store";
import { Sale, todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { ksh } from "@/lib/format";
import { toast } from "sonner";
import { ReceiptDialog } from "./ReceiptDialog";

/**
 * Rooms — the hotel front desk. Deliberately flexible & simple: the room
 * manager defines their own room types + prices (Setup tab); guest details are
 * mostly optional so it fits however a given place likes to run bookings.
 */
export const Rooms = () => {
  const { org } = useAuth();
  const { types } = useRoomTypes();
  const { rooms } = useRooms();
  const { bookings } = useBookings();
  // A room stay becomes a real sale; this holds its receipt to print.
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);

  // The active (checked-in) booking for each room, for the grid + check-out.
  const activeByRoom = useMemo(() => {
    const m = new Map<string, Booking>();
    for (const b of bookings) {
      if (b.status === "checked_in" && b.roomId) m.set(b.roomId, b);
    }
    return m;
  }, [bookings]);

  const free = rooms.filter((r) => r.status === "available").length;
  const occupied = rooms.filter((r) => r.status === "occupied").length;

  // Room income earned today (billed stays created today, in Nairobi time —
  // matches how the sale is dated, so it agrees with the reports).
  const today = todayISO();
  const nairobiDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const todayIncome = bookings
    .filter((b) => b.saleId && b.paid && nairobiDate(b.createdAt) === today)
    .reduce((a, b) => a + b.amount, 0);

  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [checkOutBooking, setCheckOutBooking] = useState<Booking | null>(null);
  const [bookingDetail, setBookingDetail] = useState<Booking | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BedDouble className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold tracking-tight">Rooms</h2>
      </div>

      <Tabs defaultValue="desk" className="space-y-6">
        <TabsList className="grid w-full sm:max-w-xs grid-cols-2 h-auto p-1 gap-1">
          <TabsTrigger value="desk" className="gap-1.5 py-2">
            <DoorOpen className="h-4 w-4" /> Front desk
          </TabsTrigger>
          <TabsTrigger value="setup" className="gap-1.5 py-2">
            <Settings2 className="h-4 w-4" /> Setup
          </TabsTrigger>
        </TabsList>

        {/* ── FRONT DESK ─────────────────────────────────────────── */}
        <TabsContent value="desk" className="space-y-4 m-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 shadow-soft bg-gradient-primary text-primary-foreground">
              <p className="text-[10px] uppercase tracking-wider opacity-80">Today's room income</p>
              <p className="text-2xl font-bold">{ksh(todayIncome)}</p>
            </Card>
            <Card className="p-4 shadow-soft">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rooms</p>
              <p className="text-2xl font-bold">{rooms.length}</p>
            </Card>
            <Card className="p-4 shadow-soft border-success/40">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Available</p>
              <p className="text-2xl font-bold text-success">{free}</p>
            </Card>
            <Card className="p-4 shadow-soft border-destructive/40">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Occupied</p>
              <p className="text-2xl font-bold text-destructive">{occupied}</p>
            </Card>
          </div>

          {rooms.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground shadow-soft">
              No rooms yet. Add room types and rooms in the <b>Setup</b> tab.
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {rooms.map((r) => {
                const b = activeByRoom.get(r.id);
                const maint = r.status === "maintenance";
                const occ = r.status === "occupied";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      if (maint) return;
                      if (occ && b) setCheckOutBooking(b);
                      else setCheckInRoom(r);
                    }}
                    disabled={maint}
                    className={`rounded-xl border p-4 text-left transition-all hover:shadow-soft active:scale-[0.98] ${
                      maint
                        ? "border-muted bg-muted/40 opacity-70 cursor-not-allowed"
                        : occ
                          ? "border-destructive/50 bg-destructive/5"
                          : "border-success/50 bg-success/5"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-lg">{r.roomNo}</p>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          maint ? "" : occ ? "text-destructive" : "text-success"
                        }`}
                      >
                        {maint ? "Maintenance" : occ ? "Occupied" : "Available"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.typeName ?? "No type"}</p>
                    {r.pricePerNight != null && (
                      <p className="text-xs font-semibold text-primary">{ksh(r.pricePerNight)} / night</p>
                    )}
                    {occ && b && (
                      <p className="text-xs mt-1 truncate">
                        <span className="font-medium">{b.guestName}</span>
                        <span className="text-muted-foreground"> · tap to check out</span>
                      </p>
                    )}
                    {!occ && !maint && (
                      <p className="text-[11px] text-muted-foreground mt-1">Tap to check in a guest</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Recent bookings */}
          {bookings.length > 0 && (
            <Card className="overflow-hidden shadow-soft">
              <div className="p-4 border-b bg-gradient-surface">
                <h3 className="font-semibold">Recent bookings</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
                    <tr>
                      <th className="text-left p-3 font-semibold">Guest</th>
                      <th className="text-left p-3 font-semibold">Room</th>
                      <th className="text-left p-3 font-semibold">In</th>
                      <th className="text-left p-3 font-semibold">Out</th>
                      <th className="text-right p-3 font-semibold">Amount</th>
                      <th className="text-left p-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.slice(0, 15).map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => setBookingDetail(b)}
                        className="border-t cursor-pointer hover:bg-muted/40"
                      >
                        <td className="p-3">
                          <div className="font-medium">{b.guestName}</div>
                          {b.guestPhone && <div className="text-xs text-muted-foreground">{b.guestPhone}</div>}
                        </td>
                        <td className="p-3">{b.roomNo ?? "—"}</td>
                        <td className="p-3 text-xs">{b.checkIn}</td>
                        <td className="p-3 text-xs">{b.checkOut ?? "—"}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">
                          {b.amount > 0 ? ksh(b.amount) : "—"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              b.status === "checked_in" ? "text-destructive"
                                : b.status === "checked_out" ? "text-success" : ""
                            }`}
                          >
                            {b.status.replace("_", " ")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ── SETUP ──────────────────────────────────────────────── */}
        <TabsContent value="setup" className="space-y-6 m-0">
          <RoomTypesSetup />
          <RoomsSetup roomTypes={types} />
        </TabsContent>
      </Tabs>

      <CheckInDialog room={checkInRoom} onClose={() => setCheckInRoom(null)} onSale={setReceiptSale} />
      <CheckOutDialog booking={checkOutBooking} onClose={() => setCheckOutBooking(null)} onSale={setReceiptSale} />
      <BookingDialog
        booking={bookingDetail}
        onClose={() => setBookingDetail(null)}
        onSale={(s) => { setBookingDetail(null); setReceiptSale(s); }}
      />

      {/* Room-stay receipt — same receipt used everywhere else. */}
      <ReceiptDialog
        sale={receiptSale}
        products={[]}
        open={!!receiptSale}
        onClose={() => setReceiptSale(null)}
        autoPrint
        shopName={org?.name}
        logoUrl={org?.logo_url}
        tagline={org?.tagline}
        phone={org?.phone}
        mpesaPaybill={org?.mpesa_paybill}
        mpesaPaybillAccount={org?.mpesa_paybill_account}
        mpesaTill={org?.mpesa_till}
      />
    </div>
  );
};

/* ── Room types setup ─────────────────────────────────────────── */
function RoomTypesSetup() {
  const { types, addType, removeType } = useRoomTypes();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [desc, setDesc] = useState("");

  const submit = async () => {
    const p = Number(price);
    const c = Number(capacity);
    if (!name.trim()) return toast.error("Enter a room type name");
    if (!Number.isFinite(p) || p < 0) return toast.error("Enter a valid price per night");
    try {
      await addType({ name: name.trim(), pricePerNight: p, capacity: Number.isFinite(c) && c > 0 ? c : 2, description: desc.trim() || undefined });
      setName(""); setPrice(""); setCapacity("2"); setDesc("");
      toast.success("Room type added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  };

  return (
    <Card className="overflow-hidden shadow-soft">
      <div className="p-4 border-b bg-gradient-surface">
        <h3 className="font-semibold">Room types</h3>
        <p className="text-xs text-muted-foreground">
          Your categories and their nightly price — add whatever you offer.
        </p>
      </div>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Type name</Label>
          <Input placeholder="e.g. Deluxe Double" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price / night (Ksh)</Label>
          <Input type="number" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} className="no-spinner" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sleeps</Label>
          <Input type="number" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="no-spinner" />
        </div>
        <Button onClick={submit} className="gap-1.5"><Plus className="h-4 w-4" /> Add type</Button>
      </div>
      {types.length > 0 && (
        <div className="border-t divide-y">
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">Sleeps {t.capacity}{t.description ? ` · ${t.description}` : ""}</p>
              </div>
              <span className="font-semibold text-primary tabular-nums">{ksh(t.pricePerNight)}/night</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeType(t.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Rooms setup ──────────────────────────────────────────────── */
function RoomsSetup({ roomTypes }: { roomTypes: { id: string; name: string }[] }) {
  const { rooms, addRoom, removeRoom, setRoomStatus } = useRooms();
  const [roomNo, setRoomNo] = useState("");
  const [typeId, setTypeId] = useState<string>("none");

  const submit = async () => {
    if (!roomNo.trim()) return toast.error("Enter a room number");
    try {
      await addRoom({ roomNo: roomNo.trim(), roomTypeId: typeId === "none" ? null : typeId });
      setRoomNo("");
      toast.success("Room added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add room");
    }
  };

  return (
    <Card className="overflow-hidden shadow-soft">
      <div className="p-4 border-b bg-gradient-surface">
        <h3 className="font-semibold">Rooms</h3>
        <p className="text-xs text-muted-foreground">Add each room and pick its type.</p>
      </div>
      <div className="p-4 grid sm:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Room number</Label>
          <Input placeholder="e.g. 12" value={roomNo} onChange={(e) => setRoomNo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger><SelectValue placeholder="Pick a type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No type</SelectItem>
              {roomTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={submit} className="gap-1.5"><Plus className="h-4 w-4" /> Add room</Button>
      </div>
      {rooms.length > 0 && (
        <div className="border-t divide-y">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <p className="font-bold w-14">{r.roomNo}</p>
              <div className="flex-1 min-w-0 text-xs text-muted-foreground">
                {r.typeName ?? "No type"}{r.pricePerNight != null ? ` · ${ksh(r.pricePerNight)}/night` : ""}
              </div>
              <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
              <Button
                size="icon" variant="ghost" className="h-8 w-8"
                title={r.status === "maintenance" ? "Mark available" : "Mark maintenance"}
                onClick={() => setRoomStatus(r.id, r.status === "maintenance" ? "available" : "maintenance")}
                disabled={r.status === "occupied"}
              >
                <Wrench className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeRoom(r.id)} disabled={r.status === "occupied"}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Check-in dialog (guest details optional) ─────────────────── */
function CheckInDialog({ room, onClose, onSale }: { room: Room | null; onClose: () => void; onSale: (s: Sale) => void }) {
  const { checkIn, payBooking } = useBookings();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNo, setIdNo] = useState("");
  const [rate, setRate] = useState("");
  const [nights, setNights] = useState("1");
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("none");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);

  // Prefill rate from the room's type when opened; amount follows rate × nights.
  const openRate = room?.pricePerNight ?? 0;
  const effRate = rate === "" ? openRate : Number(rate);
  const effNights = Number(nights) || 0;
  const autoAmount = amount === "" ? effRate * effNights : Number(amount);

  const submit = async () => {
    if (!room) return;
    if (!name.trim()) return toast.error("Enter the guest's name");
    setBusy(true);
    try {
      const bookingId = await checkIn({
        roomId: room.id,
        guestName: name.trim(),
        guestPhone: phone.trim() || undefined,
        guestIdNo: idNo.trim() || undefined,
        rate: effRate,
        nights: effNights || undefined,
        amount: Number(autoAmount) || 0,
        payment: payment === "none" ? undefined : payment,
        paid,
      });
      // Paying now (a method was chosen) → make it a real sale + print receipt.
      if (payment !== "none" && (Number(autoAmount) || 0) > 0) {
        const sale = await payBooking({ bookingId, payment, paid });
        onSale(sale);
      }
      toast.success(`${name.trim()} checked into room ${room.roomNo}`);
      setName(""); setPhone(""); setIdNo(""); setRate(""); setNights("1"); setAmount(""); setPayment("none"); setPaid(false);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!room} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-primary" /> Check in — Room {room?.roomNo}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Guest name *</Label>
            <Input placeholder="Required" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Phone (optional)</Label>
              <Input placeholder="0700…" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ID / Passport (optional)</Label>
              <Input value={idNo} onChange={(e) => setIdNo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Rate / night</Label>
              <Input type="number" inputMode="decimal" placeholder={String(openRate)} value={rate} onChange={(e) => setRate(e.target.value)} className="no-spinner" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nights</Label>
              <Input type="number" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} className="no-spinner" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" inputMode="decimal" placeholder={String(effRate * effNights)} value={amount} onChange={(e) => setAmount(e.target.value)} className="no-spinner" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Payment (optional)</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not yet</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
              Paid
            </label>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full bg-gradient-primary h-11 font-semibold">
            {busy ? "Checking in…" : `Check in — ${ksh(Number(autoAmount) || 0)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Booking details: edit nights/amount + print or bill the receipt ── */
function BookingDialog({ booking, onClose, onSale }: { booking: Booking | null; onClose: () => void; onSale: (s: Sale) => void }) {
  const { editBooking, getSale, payBooking } = useBookings();
  const [nights, setNights] = useState("");
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("cash");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNights(booking?.nights != null ? String(booking.nights) : "");
    setAmount(booking ? String(booking.amount) : "");
    setPayment("cash");
  }, [booking?.id]);

  if (!booking) return null;
  const billed = !!booking.saleId;
  const cancelled = booking.status === "cancelled";
  const rate = booking.rate || 0;

  // Fixing the nights should re-price the stay (nights × rate). The amount stays
  // editable for a manual override (e.g. a discount), but by default it tracks
  // nights so you can never leave "2 nights" priced as 7.
  const onNightsChange = (v: string) => {
    setNights(v);
    const n = Number(v);
    if (rate > 0 && Number.isFinite(n) && n >= 0) setAmount(String(n * rate));
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await editBooking({ bookingId: booking.id, nights: nights === "" ? null : Number(nights), amount: Number(amount) || 0 });
      toast.success(billed ? "Updated — receipt re-priced" : "Updated");
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };
  const printReceipt = async () => {
    if (!booking.saleId) return;
    setBusy(true);
    try { onSale(await getSale(booking.saleId)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };
  const billNow = async () => {
    setBusy(true);
    try { onSale(await payBooking({ bookingId: booking.id, payment, paid: true })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{booking.guestName} · Room {booking.roomNo ?? "—"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            In {booking.checkIn}{booking.checkOut ? ` · Out ${booking.checkOut}` : ""} ·{" "}
            {booking.status.replace("_", " ")}{billed ? " · billed" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Nights</Label>
              <Input type="number" inputMode="numeric" value={nights} onChange={(e) => onNightsChange(e.target.value)} className="no-spinner" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount (Ksh)</Label>
              <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="no-spinner" />
            </div>
          </div>
          {rate > 0 && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              Rate {ksh(rate)}/night — changing nights updates the amount (you can still override it).
            </p>
          )}
          <Button variant="outline" onClick={saveEdit} disabled={busy} className="w-full">
            {busy ? "Saving…" : billed ? "Save & re-price receipt" : "Save changes"}
          </Button>

          {billed ? (
            <Button onClick={printReceipt} disabled={busy} className="w-full bg-gradient-primary h-11 font-semibold gap-1.5">
              <Printer className="h-4 w-4" /> Print receipt
            </Button>
          ) : !cancelled ? (
            <div className="space-y-2 border-t pt-3">
              <div className="space-y-1">
                <Label className="text-xs">Payment</Label>
                <Select value={payment} onValueChange={setPayment}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={billNow} disabled={busy} className="w-full bg-gradient-primary h-11 font-semibold">
                Bill &amp; print — {ksh(Number(amount) || booking.amount)}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Check-out dialog ─────────────────────────────────────────── */
function CheckOutDialog({ booking, onClose, onSale }: { booking: Booking | null; onClose: () => void; onSale: (s: Sale) => void }) {
  const { checkOut, payBooking } = useBookings();
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("cash");
  const [paid, setPaid] = useState(true);
  const [busy, setBusy] = useState(false);

  // Already billed at check-in? Then it's just freeing the room.
  const alreadyBilled = booking?.paid || false;

  const submit = async () => {
    if (!booking) return;
    setBusy(true);
    try {
      const finalAmount = amount === "" ? undefined : Number(amount);
      await checkOut({ id: booking.id, amount: finalAmount, paid: paid || undefined });
      // Bill it (unless it was already paid at check-in) → receipt + counts in reports.
      if (paid && !alreadyBilled) {
        const sale = await payBooking({ bookingId: booking.id, payment, paid: true });
        onSale(sale);
      }
      toast.success(`${booking.guestName} checked out — room freed`);
      setAmount(""); setPayment("cash"); setPaid(true);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check-out failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-4 w-4 text-primary" /> Check out
          </DialogTitle>
        </DialogHeader>
        {booking && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-semibold">{booking.guestName}</span> · Room {booking.roomNo}
              <br />
              <span className="text-xs text-muted-foreground">
                In: {booking.checkIn}{booking.amount > 0 ? ` · charged ${ksh(booking.amount)}` : ""}
                {alreadyBilled ? " · already paid" : ""}
              </span>
            </p>
            {!alreadyBilled && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Final amount (leave to keep {ksh(booking.amount)})</Label>
                  <Input type="number" inputMode="decimal" placeholder={String(booking.amount)} value={amount} onChange={(e) => setAmount(e.target.value)} className="no-spinner" />
                </div>
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Payment</Label>
                    <Select value={payment} onValueChange={setPayment}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="mpesa">M-Pesa</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="credit">Credit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
                    Paid (make receipt)
                  </label>
                </div>
              </>
            )}
            <Button onClick={submit} disabled={busy} className="w-full bg-gradient-primary h-11 font-semibold">
              {busy ? "Checking out…" : paid && !alreadyBilled ? "Check out, bill & print" : "Check out & free the room"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
