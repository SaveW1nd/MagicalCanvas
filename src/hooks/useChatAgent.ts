/**
 * useChatAgent.ts
 *
 * 聊天 Agent hook（function-calling 版）。
 * 管理消息、会话、主题，并驱动**多轮工具循环**：
 *   POST /api/chat → 收到 tool_calls → 调 onToolCalls 在画布执行 → 拿结果
 *   → POST /api/chat/tools 续上 → 直到模型给出最终回复(done)，上限 MAX_AGENT_STEPS 轮。
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    media?: {
        type: 'image' | 'video';
        url: string;
    }[]; // Array of media attachments
    timestamp: Date;
}

export interface ChatSession {
    id: string;
    topic: string;
    createdAt: string;
    updatedAt?: string;
    messageCount: number;
}

/** 模型发起的工具调用（OpenAI tool_calls 结构） */
export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

/** 工具执行结果，回传给后端续上下一轮 */
export interface ToolResult {
    tool_call_id: string;
    /** 结果内容（JSON 字符串或纯文本），会作为 role:"tool" 消息喂回模型 */
    content: string;
}

/** 一个 turn 内最多自主调用工具的轮数（与后端 MAX_AGENT_STEPS 对齐） */
const MAX_AGENT_STEPS = 10;

interface UseChatAgentOptions {
    /** 收到模型的工具调用时回调：在画布执行并返回每个调用的结果 */
    onToolCalls?: (calls: ToolCall[]) => Promise<ToolResult[]>;
}

interface UseChatAgentReturn {
    messages: ChatMessage[];
    topic: string | null;
    sessionId: string | null;
    isLoading: boolean;
    error: string | null;
    sessions: ChatSession[];
    isLoadingSessions: boolean;
    sendMessage: (content: string, media?: { type: 'image' | 'video'; url: string; base64?: string }[]) => Promise<void>;
    startNewChat: () => void;
    loadSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<void>;
    hasMessages: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Generate a unique session ID */
function generateSessionId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Generate a unique message ID */
function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** 一个 turn 内某次模型调用的终止事件 */
type TerminalEvent =
    | { type: 'done'; response: string; topic?: string | null }
    | { type: 'tool_calls'; tool_calls: ToolCall[]; content: string };

/**
 * 消费一条 SSE 流直到结束。
 * 边读边把文字增量交给 onDelta 渲染；topic 事件交给 onTopic；
 * 返回该次调用的终止事件（done 或 tool_calls）。
 */
async function consumeChatStream(
    response: Response,
    onDelta: (text: string) => void,
    onTopic: (topic: string) => void,
): Promise<TerminalEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal: TerminalEvent | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: any;
            try { evt = JSON.parse(line.slice(6)); } catch { continue; }
            if (evt.type === 'delta' && evt.text) {
                onDelta(evt.text);
            } else if (evt.type === 'tool_calls') {
                terminal = { type: 'tool_calls', tool_calls: evt.tool_calls || [], content: evt.content || '' };
            } else if (evt.type === 'done') {
                terminal = { type: 'done', response: evt.response || '', topic: evt.topic };
            } else if (evt.type === 'topic') {
                if (evt.topic) onTopic(evt.topic);
            } else if (evt.type === 'error') {
                throw new Error(evt.error || 'Chat failed');
            }
        }
    }

    if (!terminal) throw new Error('连接中断，未收到完整回复');
    return terminal;
}

// ============================================================================
// HOOK
// ============================================================================

export function useChatAgent(options?: UseChatAgentOptions): UseChatAgentReturn {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    // --- State ---
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [topic, setTopic] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);

    // Use ref to track if we've initialized a session
    const hasInitializedRef = useRef(false);

    // --- Callbacks ---

    /** Initialize a new session if needed */
    const ensureSession = useCallback(() => {
        if (!sessionId) {
            const newSessionId = generateSessionId();
            setSessionId(newSessionId);
            return newSessionId;
        }
        return sessionId;
    }, [sessionId]);

    /** Fetch all chat sessions from the server */
    const refreshSessions = useCallback(async () => {
        setIsLoadingSessions(true);
        try {
            const response = await fetch('/api/chat/sessions');
            if (response.ok) {
                const data = await response.json();
                setSessions(data);
            }
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
        } finally {
            setIsLoadingSessions(false);
        }
    }, []);

    /** Load a specific session by ID */
    const loadSession = useCallback(async (targetSessionId: string) => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/chat/sessions/${targetSessionId}`);
            if (!response.ok) {
                throw new Error('Session not found');
            }

            const data = await response.json();

            // Convert messages to ChatMessage format
            const loadedMessages: ChatMessage[] = data.messages.map((msg: any, index: number) => ({
                id: `loaded-${targetSessionId}-${index}`,
                role: msg.role,
                content: msg.content,
                media: msg.media,
                timestamp: new Date(msg.timestamp || data.createdAt),
            }));

            setSessionId(targetSessionId);
            setMessages(loadedMessages);
            setTopic(data.topic);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load session';
            setError(errorMessage);
            console.error('Load session error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    /** Delete a session */
    const deleteSession = useCallback(async (targetSessionId: string) => {
        try {
            await fetch(`/api/chat/sessions/${targetSessionId}`, { method: 'DELETE' });
            await refreshSessions();
            if (targetSessionId === sessionId) {
                setMessages([]);
                setTopic(null);
                setSessionId(generateSessionId());
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    }, [sessionId, refreshSessions]);

    /**
     * 发送一条消息并驱动多轮工具循环。
     */
    const sendMessage = useCallback(async (
        content: string,
        media?: { type: 'image' | 'video'; url: string; base64?: string }[]
    ) => {
        const currentSessionId = ensureSession();
        setError(null);
        setIsLoading(true);

        // Add user message immediately
        const userMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'user',
            content,
            media: media ? media.map(m => ({ type: m.type, url: m.url })) : undefined,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        // 整个 turn 共用一条 assistant 气泡，文字增量持续累积
        const aiMessageId = generateMessageId();
        let aiText = '';
        const upsertAi = (text: string) => {
            setMessages(prev => {
                const idx = prev.findIndex(m => m.id === aiMessageId);
                const msg: ChatMessage = { id: aiMessageId, role: 'assistant', content: text, timestamp: new Date() };
                if (idx === -1) return [...prev, msg];
                const next = [...prev];
                next[idx] = { ...next[idx], content: text };
                return next;
            });
        };
        const onDelta = (text: string) => { aiText += text; upsertAi(aiText); };
        const onTopic = (t: string) => setTopic(t);

        try {
            // 第 1 轮：发用户消息
            let resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    message: content,
                    media: media ? media.map(m => ({
                        type: m.type,
                        // 库内路径直接传 url；data URL 不传避免体积翻倍
                        url: m.url && !m.url.startsWith('data:') ? m.url : undefined,
                        base64: m.base64 || m.url,
                    })) : undefined,
                }),
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || resp.statusText);
            }

            let terminal = await consumeChatStream(resp, onDelta, onTopic);

            // 多轮工具循环
            let steps = 0;
            while (terminal.type === 'tool_calls') {
                if (steps >= MAX_AGENT_STEPS) {
                    upsertAi(`${aiText}\n\n⚠️ 已达到本轮最多 ${MAX_AGENT_STEPS} 步工具调用上限，已停止。`);
                    break;
                }
                steps++;

                // 渲染"执行中"提示
                upsertAi(`${aiText}${aiText ? '\n\n' : ''}🔧 正在执行画布操作…`);

                // 在画布执行工具，拿结果
                let results: ToolResult[] = [];
                try {
                    results = optionsRef.current?.onToolCalls
                        ? await optionsRef.current.onToolCalls(terminal.tool_calls)
                        : terminal.tool_calls.map(tc => ({
                            tool_call_id: tc.id,
                            content: JSON.stringify({ error: '前端未挂载工具执行器' }),
                        }));
                } catch (e) {
                    console.error('[Agent] execute tool calls failed:', e);
                    results = terminal.tool_calls.map(tc => ({
                        tool_call_id: tc.id,
                        content: JSON.stringify({ error: String((e as Error)?.message || e) }),
                    }));
                }

                // 还原文字（去掉"执行中"提示，后续增量会接着累积）
                upsertAi(aiText);

                // 续上：回传工具结果
                resp = await fetch('/api/chat/tools', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: currentSessionId, toolResults: results }),
                });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    throw new Error(errData.error || resp.statusText);
                }
                terminal = await consumeChatStream(resp, onDelta, onTopic);
            }

            // 最终回复：用后端权威的完整文本覆盖
            if (terminal.type === 'done') {
                upsertAi(terminal.response || aiText);
                if (terminal.topic) setTopic(terminal.topic);
            }

            await refreshSessions();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
            setError(errorMessage);
            console.error('Chat error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [ensureSession, refreshSessions]);

    /** Start a new chat session */
    const startNewChat = useCallback(() => {
        setMessages([]);
        setTopic(null);
        setSessionId(generateSessionId());
        setError(null);
        hasInitializedRef.current = false;
    }, []);

    // Load sessions on mount
    useEffect(() => {
        refreshSessions();
    }, [refreshSessions]);

    return {
        messages,
        topic,
        sessionId,
        isLoading,
        error,
        sessions,
        isLoadingSessions,
        sendMessage,
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
