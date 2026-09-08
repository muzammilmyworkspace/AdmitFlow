"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

// The notification centre.
//
// The API for this has existed since Phase 16 — list, mark-one-read, mark-all-read, with
// pagination and an unread count — and nothing in the interface ever called it. Every
// notification the platform raised (assessment ready, document verified, payment
// received, a consultant review delivered) went into the database and was never shown to
// the person it was for.

interface NotificationItem {
  id: string;
  event: string | null;
  title: string | null;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Coarse relative time. Precise timestamps in a dropdown are noise. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const response = await apiGet<{ notifications: NotificationItem[]; unreadCount: number }>(
      "/api/v1/notifications?pageSize=10",
    );
    setItems(response.notifications);
    setUnread(response.unreadCount);
  }, []);

  useEffect(() => {
    // A failure here must not break the shell it lives in — the bell is peripheral to
    // whatever the student came to do.
    load()
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [load]);

  // Close on outside click and on Escape: a dropdown that can only be dismissed by
  // clicking the trigger again is the kind of thing people report as "it got stuck".
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Refresh on open so the panel is never showing a stale list from page load.
    if (next) await load().catch(() => undefined);
  }

  async function markAllRead() {
    // Optimistic: the request is idempotent and a failure only means the badge comes
    // back on the next load, which is a better outcome than a spinner on a bell.
    setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnread(0);
    try {
      await apiPost("/api/v1/notifications/read-all");
    } catch (error) {
      if (error instanceof ApiError) await load().catch(() => undefined);
    }
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    setUnread((n) => Math.max(0, n - 1));
    await apiPost(`/api/v1/notifications/${id}/read`).catch(() => undefined);
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex items-center rounded-md p-2 text-text-secondary transition-colors duration-fast hover:bg-primary-50/60 hover:text-text-primary"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary-600 px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-lg animate-fade-in"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors duration-fast hover:bg-primary-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-text-secondary">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Inbox className="mx-auto mb-2 h-6 w-6 text-text-muted" aria-hidden />
                <p className="text-sm font-medium text-text-primary">Nothing yet</p>
                <p className="mt-1 text-xs text-text-secondary">
                  We&apos;ll tell you here when your assessment is ready, a document is
                  reviewed, or a deadline is close.
                </p>
              </div>
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => !item.isRead && markRead(item.id)}
                      className={cn(
                        "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-fast last:border-b-0 hover:bg-bg",
                        !item.isRead && "bg-primary-50/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          item.isRead ? "bg-transparent" : "bg-secondary-600",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-text-primary">
                          {item.title ?? "Update"}
                        </span>
                        {item.body && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                            {item.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-text-muted">
                          {relativeTime(item.createdAt)}
                          {!item.isRead && " · unread"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
