"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";

interface Slot {
  id: string;
  consultantName: string;
  specialties: string[];
  startsAtUtc: string;
  endsAtUtc: string;
  durationMinutes: number;
}

interface Booking {
  id: string;
  status: string;
  consultantName: string;
  startsAtUtc: string;
  endsAtUtc: string;
  holdExpiresAtUtc: string | null;
  meetingLink: string | null;
  cancellable: boolean;
  cancellationWouldBeLate: boolean;
}

// Slots come back as UTC instants; the browser renders them in the viewer's own zone.
// Doing the conversion here rather than server-side means the displayed time is always
// the one on the student's own clock, which is the only one they'll act on.
function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConsultationView() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [slotsResponse, bookingsResponse] = await Promise.all([
      apiGet<{ slots: Slot[] }>("/api/v1/consultation/slots"),
      apiGet<{ bookings: Booking[] }>("/api/v1/consultation/bookings"),
    ]);
    setSlots(slotsResponse.slots);
    setBookings(bookingsResponse.bookings);
  }, []);

  useEffect(() => {
    load()
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load consultation slots."),
      )
      .finally(() => setIsLoading(false));
  }, [load]);

  async function reserveAndPay(slotId: string) {
    if (busySlot) return;
    setBusySlot(slotId);
    setError(null);
    try {
      const hold = await apiPost<{ bookingId: string }>("/api/v1/consultation/bookings", {
        slotId,
      });
      const checkout = await apiPost<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
        productKey: "CONSULTATION_40MIN",
        bookingId: hold.bookingId,
      });
      window.location.href = checkout.checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reserve that slot.");
      setBusySlot(null);
      await load();
    }
  }

  async function cancel(bookingId: string) {
    setError(null);
    try {
      await apiDelete(`/api/v1/consultation/bookings/${bookingId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel that booking.");
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const upcoming = bookings.filter(
    (b) => b.status === "CONFIRMED" || b.status === "HELD",
  );

  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Your sessions
          </h2>
          <ul className="space-y-3">
            {upcoming.map((booking) => (
              <li key={booking.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Badge tone={booking.status === "CONFIRMED" ? "success" : "warning"}>
                        {booking.status === "CONFIRMED" ? "Confirmed" : "Awaiting payment"}
                      </Badge>
                      <p className="mt-1.5 font-medium text-text-primary">
                        {formatLocal(booking.startsAtUtc)}
                      </p>
                      <p className="text-sm text-text-secondary">
                        with {booking.consultantName} · shown in your local time
                      </p>
                      {booking.status === "HELD" && booking.holdExpiresAtUtc && (
                        <p className="mt-1 text-xs text-warning">
                          This slot is held until {formatLocal(booking.holdExpiresAtUtc)} — complete
                          payment before then or it goes back to the pool.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {booking.meetingLink && (
                        <a
                          href={booking.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-primary underline"
                        >
                          Join link
                        </a>
                      )}
                      {booking.cancellable && (
                        <Button variant="ghost" size="sm" onClick={() => cancel(booking.id)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  {booking.cancellationWouldBeLate && (
                    <p className="mt-3 border-t border-text-secondary/15 pt-3 text-xs text-text-secondary">
                      Free cancellation has passed for this session — cancelling now is recorded
                      as a late cancellation.
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Available times
        </h2>
        <p className="mb-3 text-sm text-text-secondary">
          40 minutes with a verified consultant · €30 · times shown in your local timezone
        </p>

        {slots.length === 0 ? (
          <EmptyState
            title="No slots available right now"
            description="Consultants publish availability a few weeks ahead. Check back shortly."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {slots.slice(0, 20).map((slot) => (
              <li key={slot.id}>
                <Card className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">{formatLocal(slot.startsAtUtc)}</p>
                    <p className="truncate text-sm text-text-secondary">
                      {slot.consultantName} · {slot.durationMinutes} min
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => reserveAndPay(slot.id)}
                    isLoading={busySlot === slot.id}
                  >
                    Book
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
