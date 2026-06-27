/**
 * ThemeContext — 应用固定深色（无浅色模式）。
 *
 * 保留这个 Provider/hook 只为给画布等消费方提供恒定的 'dark' 主题值，并在
 * 挂载时确保 <html> 带 `dark` 类。toggle/setTheme 为 no-op。
 */
import React, { createContext, useContext, useEffect } from 'react';

interface ThemeCtx { theme: 'dark'; isDark: true; toggleTheme: () => void; setTheme: () => void; }

const VALUE: ThemeCtx = { theme: 'dark', isDark: true, toggleTheme: () => {}, setTheme: () => {} };

const Ctx = createContext<ThemeCtx>(VALUE);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => { document.documentElement.classList.add('dark'); }, []);
    return <Ctx.Provider value={VALUE}>{children}</Ctx.Provider>;
};

export const useTheme = () => useContext(Ctx);
