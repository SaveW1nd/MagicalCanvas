import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  Image as ImageIcon,
  MessageSquare,
  History,
  Sparkles,
  MoreHorizontal,
  Plus,
  Film,
  Scissors,
  Wand2,
  Sun,
  Moon
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// 悬停即时提示：图标右侧弹出标签（比原生 title 更快、有样式）
const Tip: React.FC<{ label: string; isDark: boolean; hidden?: boolean; children: React.ReactNode }> = ({ label, isDark, hidden, children }) => (
  <div className="relative group/tt flex items-center justify-center">
    {children}
    {!hidden && (
      <span
        className={`pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md text-xs whitespace-nowrap opacity-0 group-hover/tt:opacity-100 transition-opacity duration-150 shadow-lg z-[60] ${isDark ? 'bg-neutral-800 text-neutral-100 border border-neutral-700' : 'bg-white text-neutral-800 border border-neutral-200'}`}
      >
        {label}
      </span>
    )}
  </div>
);

// ============================================================================
// TYPES
// ============================================================================

interface ToolbarProps {
  onAddClick?: (e: React.MouseEvent) => void;
  onWorkflowsClick?: (e: React.MouseEvent) => void;
  onHistoryClick?: (e: React.MouseEvent) => void;
  onAssetsClick?: (e: React.MouseEvent) => void;
  onStoryboardClick?: (e: React.MouseEvent) => void;
  onStoryWorkflowClick?: (e: React.MouseEvent) => void;
  onVideoStudioClick?: (e: React.MouseEvent) => void;
  onToolsOpen?: () => void; // Called when tools dropdown opens to close other panels
  canvasTheme?: 'dark' | 'light';
}

// ============================================================================
// COMPONENT
// ============================================================================

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddClick,
  onWorkflowsClick,
  onHistoryClick,
  onAssetsClick,
  onStoryboardClick,
  onStoryWorkflowClick,
  onVideoStudioClick,
  onToolsOpen,
  canvasTheme = 'dark'
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };

    if (isToolsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isToolsOpen]);

  const handleToolClick = (callback?: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    setIsToolsOpen(false);
    callback?.(e);
  };

  // Theme-aware styles
  const isDark = canvasTheme === 'dark';

  return (
    <div className={`fixed left-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 p-1 rounded-full shadow-2xl z-50 transition-colors duration-300 ${isDark ? 'bg-[#1a1a1a] border border-neutral-800' : 'bg-white/90 backdrop-blur-sm border border-neutral-200'
      }`}>
      <Tip label="新建节点" isDark={isDark}>
        <button
          className={`w-10 h-10 rounded-full flex items-center justify-center hover:scale-110 transition-all duration-200 mb-2 ${isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-neutral-900 text-white hover:bg-neutral-700'
            }`}
          onClick={onAddClick}
          title="新建节点"
        >
          <Plus size={20} />
        </button>
      </Tip>

      <div className="flex flex-col gap-4 pt-2 pb-4 px-1">
        <Tip label="我的工作流" isDark={isDark}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            onClick={onWorkflowsClick}
            title="我的工作流"
          >
            <LayoutGrid size={20} />
          </button>
        </Tip>
        <Tip label="素材库" isDark={isDark}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            title="素材库"
            onClick={onAssetsClick}
          >
            <ImageIcon size={20} />
          </button>
        </Tip>
        <Tip label="历史记录" isDark={isDark}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            onClick={onHistoryClick}
            title="历史记录"
          >
            <History size={20} />
          </button>
        </Tip>

        {/* Tools Dropdown */}
        <div className="relative group/tt flex items-center justify-center" ref={toolsRef}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark
              ? `text-neutral-400 hover:text-white ${isToolsOpen ? 'text-white' : ''}`
              : `text-neutral-500 hover:text-neutral-900 ${isToolsOpen ? 'text-neutral-900' : ''}`
              }`}
            onClick={() => {
              if (!isToolsOpen) {
                onToolsOpen?.(); // Close other panels when opening tools
              }
              setIsToolsOpen(!isToolsOpen);
            }}
            title="AI 创作"
          >
            <Sparkles size={20} />
          </button>
          {!isToolsOpen && (
            <span className={`pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md text-xs whitespace-nowrap opacity-0 group-hover/tt:opacity-100 transition-opacity duration-150 shadow-lg z-[60] ${isDark ? 'bg-neutral-800 text-neutral-100 border border-neutral-700' : 'bg-white text-neutral-800 border border-neutral-200'}`}>
              AI 创作
            </span>
          )}

          {/* Dropdown Menu */}
          {isToolsOpen && (
            <div className={`absolute left-10 top-0 rounded-lg shadow-2xl py-2 min-w-[240px] z-50 ${isDark ? 'bg-[#1a1a1a] border border-neutral-700' : 'bg-white border border-neutral-200'
              }`}>
              {/* Story Workflow (一键创建工作流) */}
              <button
                onClick={handleToolClick(onStoryWorkflowClick)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors group ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                  }`}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/25 to-violet-500/25">
                  <Wand2 size={16} className="text-cyan-400" />
                </div>
                <div className="text-left">
                  <p className={`text-sm ${isDark ? 'text-neutral-200 group-hover:text-white' : 'text-neutral-700 group-hover:text-neutral-900'}`}>一键创作</p>
                  <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>小说/剧本 → 完整工作流</p>
                </div>
              </button>

              {/* Storyboard Generator */}
              <button
                onClick={handleToolClick(onStoryboardClick)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors group ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'
                  }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                  <Film size={16} className={isDark ? 'text-white' : 'text-neutral-700'} />
                </div>
                <div className="text-left">
                  <p className={`text-sm ${isDark ? 'text-neutral-200 group-hover:text-white' : 'text-neutral-700 group-hover:text-neutral-900'}`}>分镜生成器</p>
                  <p className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>用 AI 创建场景</p>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Video Studio (视频剪辑) */}
        <Tip label="视频剪辑" isDark={isDark}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            onClick={onVideoStudioClick}
            title="视频剪辑"
          >
            <Scissors size={20} />
          </button>
        </Tip>
      </div>
    </div>
  );
};
