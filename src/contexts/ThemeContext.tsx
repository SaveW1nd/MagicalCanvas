/**
 * ThemeContext — 应用固定深色（已移除浅色模式）。
 *
 * 仍保留这个 Provider/hook，只是恒为 dark：始终给 <html> 加 `dark` 类，
 * 让所有 Tailwind `dark:` 变体生效；画布等读取 `theme` 的地方也恒拿到 'dark'。
 * toggle/setTheme 为 no-op，forceDark 仅作兼容保留。
 */
import React, { createContext, useContext, useEffect } from 'react';

interface ThemeCtx {
    theme: 'dark'; isDark: true; toggleTheme: () => void; setTheme: () => void;
    forceDark: boolean; setForceDark: (v: boolean) => void;
}

const VALUE: ThemeCtx = { theme: 'dark', isDark: true, toggleTheme: () => {}, setTheme: () => {}, forceDark: false, setForceDark: () => {} };

const Ctx = createContext<ThemeCtx>(VALUE);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => {
        document.documentElement.classList.add('dark');
        try { localStorage.setItem('mc_theme', 'dark'); } catch { /* ignore */ }
    }, []);
    return <Ctx.Provider value={VALUE}>{children}</Ctx.Provider>;
};

export const useTheme = () => useContext(Ctx);
