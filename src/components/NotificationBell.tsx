import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/notification-api";

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const [listRes, countRes] = await Promise.all([fetchNotifications(1, 10), fetchUnreadNotificationCount()]);
      setItems(listRes.items || []);
      setUnreadCount(Number(countRes.unread_count || 0));
    } catch (e) {
      toast.error(t("notification.loadFailed"), { description: String((e as Error).message || e) });
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void refreshNotifications();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications, user]);

  const unreadBadge = useMemo(() => {
    if (unreadCount <= 0) return null;
    return (
      <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    );
  }, [unreadCount]);

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refreshNotifications();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="relative border-border/70 px-3">
          <Bell className="h-4 w-4" />
          {unreadBadge}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] border-border/70 bg-card/95 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">{t("notification.title")}</div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border/70 text-[10px]">
              {t("notification.unread")}: {unreadCount}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-border/70 px-2 text-[11px]"
              disabled={markingAll || unreadCount <= 0}
              onClick={async () => {
                setMarkingAll(true);
                try {
                  await markAllNotificationsRead();
                  setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
                  setUnreadCount(0);
                } catch (e) {
                  toast.error(t("notification.markAllFailed"), { description: String((e as Error).message || e) });
                } finally {
                  setMarkingAll(false);
                }
              }}
            >
              {t("notification.markAll")}
            </Button>
          </div>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                "w-full rounded-md border p-2 text-left transition " +
                (item.is_read
                  ? "border-border/60 bg-background/40 hover:bg-background/60"
                  : "border-primary/40 bg-primary/10 hover:bg-primary/15")
              }
              onClick={async () => {
                if (item.is_read) return;
                try {
                  await markNotificationRead(item.id);
                  setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)));
                  setUnreadCount((prev) => Math.max(0, prev - 1));
                } catch (e) {
                  toast.error(t("notification.markReadFailed"), { description: String((e as Error).message || e) });
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="line-clamp-1 text-xs font-semibold">{item.title}</div>
                {!item.is_read ? <span className="h-2 w-2 rounded-full bg-destructive" /> : null}
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.content}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {new Date(item.created_at).toLocaleString()}
              </div>
            </button>
          ))}

          {!items.length && !loading ? (
            <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-3 text-center text-xs text-muted-foreground">
              {t("notification.empty")}
            </div>
          ) : null}
          {loading ? <div className="text-center text-xs text-muted-foreground">{t("common.loading")}</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
