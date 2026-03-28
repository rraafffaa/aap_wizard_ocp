import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseWebSocketOptions {
  url: string;
  onMessage: (data: any) => void;
  onError?: (error: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  enabled?: boolean;
}

export interface UseWebSocketReturn {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  send: (data: any) => void;
  close: () => void;
  reconnect: () => void;
}

const DEFAULT_RECONNECT_INTERVAL = 2000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const BACKOFF_MULTIPLIER = 1.5;
const MAX_BACKOFF = 30000;

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    onMessage,
    onError,
    onOpen,
    onClose,
    reconnect: shouldReconnect = true,
    reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    enabled = true,
  } = options;

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const mountedRef = useRef(true);

  const callbacksRef = useRef({ onMessage, onError, onOpen, onClose });
  callbacksRef.current = { onMessage, onError, onOpen, onClose };

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return;
      }
    }

    setConnecting(true);
    intentionalCloseRef.current = false;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setConnecting(false);
        setReconnecting(false);
        setReconnectAttempt(0);
        attemptRef.current = 0;
        callbacksRef.current.onOpen?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          callbacksRef.current.onMessage(data);
        } catch {
          callbacksRef.current.onMessage(event.data);
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        callbacksRef.current.onError?.('WebSocket connection error');
      };

      ws.onclose = (event: CloseEvent) => {
        if (!mountedRef.current) return;

        setConnected(false);
        setConnecting(false);
        wsRef.current = null;
        callbacksRef.current.onClose?.();

        if (
          intentionalCloseRef.current ||
          !shouldReconnect ||
          event.code === 1000
        ) {
          setReconnecting(false);
          return;
        }

        scheduleReconnect();
      };
    } catch (err: any) {
      if (!mountedRef.current) return;
      setConnecting(false);
      callbacksRef.current.onError?.(`Failed to create WebSocket: ${err.message}`);

      if (shouldReconnect) {
        scheduleReconnect();
      }
    }
  }, [url, enabled, shouldReconnect]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !shouldReconnect) return;

    attemptRef.current += 1;
    const attempt = attemptRef.current;

    if (attempt > maxReconnectAttempts) {
      setReconnecting(false);
      callbacksRef.current.onError?.(
        `Max reconnection attempts (${maxReconnectAttempts}) reached`,
      );
      return;
    }

    setReconnecting(true);
    setReconnectAttempt(attempt);

    const delay = Math.min(
      reconnectInterval * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
      MAX_BACKOFF,
    );

    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, delay);
  }, [shouldReconnect, maxReconnectAttempts, reconnectInterval, clearReconnectTimer, connect]);

  const send = useCallback((data: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      callbacksRef.current.onError?.('Cannot send: WebSocket is not connected');
      return;
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    wsRef.current.send(payload);
  }, []);

  const close = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    setReconnecting(false);
    setReconnectAttempt(0);
    attemptRef.current = 0;

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client closed connection');
      wsRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
  }, [clearReconnectTimer]);

  const manualReconnect = useCallback(() => {
    close();
    intentionalCloseRef.current = false;
    attemptRef.current = 0;
    setReconnectAttempt(0);

    setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, 100);
  }, [close, connect]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      intentionalCloseRef.current = true;
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [url, enabled]);

  return {
    connected,
    connecting,
    reconnecting,
    reconnectAttempt,
    send,
    close,
    reconnect: manualReconnect,
  };
}
