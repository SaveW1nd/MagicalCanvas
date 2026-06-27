/**
 * ThemeToggle — floating light/dark switch, shown on every page (login/admin/canvas).
 * Mounted once at the app root (Gate).
 */
import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export const ThemeToggle: React.FC = () => {
    const { isDark, toggleTheme, forceDark } = useTheme();
    if (forceDark) return null; // 视频剪辑等强制深色工作区打开时隐藏
    return (
        <button
            onClick={toggleTheme}
            title={isDark ? '切换到浅色模式' : '切换到深色模式'}
            aria-label="切换主题"
            className="fixed bottom-6 left-4 z-[300] w-11 h-11 rounded-full flex items-center justify-center shadow-lg border transition-colors
                       bg-white border-neutral-200 text-amber-500 hover:bg-neutral-50
                       dark:bg-neutral-900 dark:border-neutral-700 dark:text-yellow-300 dark:hover:bg-neutral-800"
        >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>
    );
};
