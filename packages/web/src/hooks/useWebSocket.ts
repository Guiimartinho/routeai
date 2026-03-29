import { useEffect, useRef, useCallback, useState } from 'react';

export type WSMessageType =
  | 'review_progress'
  | 'review_complete'
  | 'review_error'
  | 'chat_token'
  | 'chat_complete'
  | 'chat_error'
  | 'connected'
  | 'ping';

export interface WSMessage {
  type: WSMessageType;
  payload: any;
}

interface UseWebSocketOptions {
  url: string;
  token?: string | null;
  projectId?: string;
  onMessage?: (message: WSMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  send: (data: WSMessage) => void;
  disconnect: () => void;
}

export function useWebSocket({
  url,
  token,
  projectId,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  autoReconnect = false,
  reconnectInterval = 3000,
  maxReconnectAttempts = 0,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoggedErrorRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      if (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();

    let wsUrl: URL;
    try {
      wsUrl = new URL(url, window.location.origin);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    } catch (e) {
      if (!hasLoggedErrorRef.current) {
        console.warn('[useWebSocket] Invalid WebSocket URL:', url);
        hasLoggedErrorRef.current = true;
      }
      return;
    }

    if (token) {
      wsUrl.searchParams.set('token', token);
    }
    if (projectId) {
      wsUrl.searchParams.set('projectId', projectId);
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl.toString());
    } catch (e) {
      if (!hasLoggedErrorRef.current) {
        console.warn('[useWebSocket] Failed to create WebSocket connection:', e);
        hasLoggedErrorRef.current = true;
      }
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      hasLoggedErrorRef.current = false;
      onConnect?.();
    };

    ws.onclose = () => {
      setIsConnected(false);
      onDisconnect?.();

      if (autoReconnect && maxReconnectAttempts > 0 &&
          reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval * Math.min(reconnectAttemptsRef.current, 5));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        onMessage?.(message);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = (event) => {
      if (!hasLoggedErrorRef.current) {
        console.warn('[useWebSocket] Connection failed for', url, '- no retry.');
        hasLoggedErrorRef.current = true;
      }
      onError?.(event);
    };
  }, [url, token, projectId, onMessage, onConnect, onDisconnect, onError, autoReconnect, reconnectInterval, maxReconnectAttempts, cleanup]);

  useEffect(() => {
    if (token) {
      connect();
    }
    return cleanup;
  }, [token, projectId, connect, cleanup]);

  const send = useCallback((data: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setIsConnected(false);
  }, [cleanup]);

  return { isConnected, send, disconnect };
}
