import { useState, useCallback, useMemo, useRef } from 'react';
import { generateId } from '../utils/formatters';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  category: string;
  timestamp: number;
  read: boolean;
  autoDismiss?: boolean;
  autoDismissMs?: number;
  action?: { label: string; onClick: () => void };
}

export interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  add: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  getByCategory: (category: string) => AppNotification[];
  getBySeverity: (severity: AppNotification['severity']) => AppNotification[];
  hasUnread: boolean;
}

const MAX_NOTIFICATIONS = 200;
const DEFAULT_AUTO_DISMISS_MS = 8_000;
const NOTIFICATION_STORAGE_KEY = 'aap-wizard-notifications';

function loadPersistedNotifications(): AppNotification[] {
  try {
    const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (!stored) return [];
    const parsed: AppNotification[] = JSON.parse(stored);
    return parsed.map((n) => ({ ...n, action: undefined }));
  } catch {
    return [];
  }
}

function persistNotifications(notifications: AppNotification[]): void {
  try {
    const serializable = notifications
      .slice(-MAX_NOTIFICATIONS)
      .map(({ action, ...rest }) => rest);
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(serializable));
  } catch { /* storage full or unavailable */ }
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<AppNotification[]>(
    () => loadPersistedNotifications(),
  );
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const hasUnread = unreadCount > 0;

  const scheduleDismiss = useCallback((id: string, ms: number) => {
    const timer = setTimeout(() => {
      dismissTimersRef.current.delete(id);
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id);
        persistNotifications(next);
        return next;
      });
    }, ms);
    dismissTimersRef.current.set(id, timer);
  }, []);

  const add = useCallback(
    (input: Omit<AppNotification, 'id' | 'timestamp' | 'read'>): string => {
      const id = generateId('notif');
      const notification: AppNotification = {
        ...input,
        id,
        timestamp: Date.now(),
        read: false,
      };

      setNotifications((prev) => {
        const next = [...prev, notification];
        if (next.length > MAX_NOTIFICATIONS) {
          next.splice(0, next.length - MAX_NOTIFICATIONS);
        }
        persistNotifications(next);
        return next;
      });

      if (input.autoDismiss !== false && input.severity !== 'error') {
        scheduleDismiss(id, input.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
      }

      return id;
    },
    [scheduleDismiss],
  );

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const idx = prev.findIndex((n) => n.id === id);
      if (idx < 0 || prev[idx].read) return prev;

      const next = [...prev];
      next[idx] = { ...next[idx], read: true };
      persistNotifications(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      if (prev.every((n) => n.read)) return prev;
      const next = prev.map((n) => (n.read ? n : { ...n, read: true }));
      persistNotifications(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }

    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (next.length === prev.length) return prev;
      persistNotifications(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    for (const timer of dismissTimersRef.current.values()) {
      clearTimeout(timer);
    }
    dismissTimersRef.current.clear();
    setNotifications([]);
    try {
      localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const getByCategory = useCallback(
    (category: string): AppNotification[] => {
      return notifications.filter((n) => n.category === category);
    },
    [notifications],
  );

  const getBySeverity = useCallback(
    (severity: AppNotification['severity']): AppNotification[] => {
      return notifications.filter((n) => n.severity === severity);
    },
    [notifications],
  );

  return {
    notifications,
    unreadCount,
    add,
    markRead,
    markAllRead,
    remove,
    clear,
    getByCategory,
    getBySeverity,
    hasUnread,
  };
}
