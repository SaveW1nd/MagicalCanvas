/**
 * AuthContext.tsx — SPA auth state.
 *
 * Installs the global fetch interceptor, validates the stored token on mount
 * (GET /api/auth/me), and exposes { user, isAdmin, loading, login, logout }.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { installAuthFetch, setTokens, clearTokens, getAccessToken } from '../utils/apiClient';

export interface AuthUser {
    id: string;
    email?: string;
    username: string;
    role: 'admin' | 'user';
    status: string;
    balance?: number; // 积分余额（百分单位整数，显示时 ÷100）
}

interface AuthContextValue {
    user: AuthUser | null;
    isAdmin: boolean;
    loading: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
    return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    // Install fetch interceptor once; on auth failure, drop the user.
    useEffect(() => {
        installAuthFetch(() => setUser(null));
    }, []);

    // Validate any stored token on mount.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!getAccessToken()) { setLoading(false); return; }
            try {
                const res = await fetch('/api/auth/me');
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled) setUser(data.user);
                } else if (!cancelled) {
                    clearTokens();
                    setUser(null);
                }
            } catch {
                if (!cancelled) setUser(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const login = useCallback(async (username: string, password: string) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '登录失败');
        setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        setUser(data.user);
    }, []);

    const logout = useCallback(async () => {
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* best effort */ }
        clearTokens();
        try { localStorage.removeItem('mc_last_workflow_id'); } catch { /* ignore */ }
        setUser(null);
    }, []);

    // 重新拉取当前用户（用于生成后刷新积分余额等）
    const refreshUser = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) { const data = await res.json().catch(() => ({})); if (data.user) setUser(data.user); }
        } catch { /* best effort */ }
    }, []);

    return (
        <AuthContext.Provider value={{ user, isAdmin: user?.role === 'admin', loading, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
};
