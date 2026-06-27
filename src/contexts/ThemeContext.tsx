/**
 * ThemeContext — global light/dark theme.
 *
 * Single source of truth for the whole app (login / admin console / canvas).
 * Persists to localStorage ('mc_theme') and toggles the `dark` class on
 * <html> so Tailwind `dark:` variants work everywhere. The canvas reads
 * `theme` directly for its prop-based theming.
 */
import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; isDark: boolean; toggleTheme: () => void; setTheme: (t: Theme) => void; }

const Ctx = createContext<ThemeCtx>({ theme: 'dark', isDark: true, toggleTheme: () => {}, setTheme: () => {} });

function readInitial(): Theme {
    try { return localStorage.getItem('mc_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function apply(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem('mc_theme', theme); } catch { /* ignore */ }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(readInitial);

    useEffect(() => { apply(theme); }, [theme]);

    const setTheme = useCallback((t: Theme) => setThemeState(t), []);
    const toggleTheme = useCallback(() => setThemeState(p => (p === 'dark' ? 'light' : 'dark')), []);

    return <Ctx.Provider value={{ theme, isDark: theme === 'dark', toggleTheme, setTheme }}>{children}</Ctx.Provider>;
};

export const useTheme = () => useContext(Ctx);
