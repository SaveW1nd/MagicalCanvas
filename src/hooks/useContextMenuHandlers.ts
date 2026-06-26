/**
 * useContextMenuHandlers.ts
 * 
 * Handles context menu operations: double-click, right-click,
 * node context menu, toolbar add button.
 */

import React, { useCallback } from 'react';
import { NodeData, NodeType, ContextMenuState, Viewport } from '../types';

interface UseContextMenuHandlersOptions {
    nodes: NodeData[];
    viewport: Viewport;
    contextMenu: ContextMenuState;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    handleOpenCreateAsset: (nodeId: string) => void;
    handleSelectTypeFromMenu: (
        type: NodeType | 'DELETE',
        contextMenu: ContextMenuState,
        viewport: Viewport,
        closeMenu: () => void
    ) => void;
}

export const useContextMenuHandlers = ({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu
}: UseContextMenuHandlersOptions) => {
    // ============================================================================
    // DOUBLE-CLICK & RIGHT-CLICK
    // ============================================================================

    // 屏幕坐标 → 画布世界坐标（供菜单锚定，随画布平移/缩放）
    const toWorld = useCallback((sx: number, sy: number) => ({
        worldX: (sx - viewport.x) / viewport.zoom,
        worldY: (sy - viewport.y) / viewport.zoom,
    }), [viewport]);

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).id === 'canvas-background') {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                ...toWorld(e.clientX, e.clientY),
                type: 'add-nodes'
            });
        }
    }, [setContextMenu, toWorld]);

    const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if ((e.target as HTMLElement).id === 'canvas-background') {
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                ...toWorld(e.clientX, e.clientY),
                type: 'global'
            });
        }
    }, [setContextMenu, toWorld]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    const handleAddNext = useCallback((nodeId: string, _direction: 'left' | 'right') => {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) return;

        setContextMenu({
            isOpen: true,
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            ...toWorld(window.innerWidth / 2, window.innerHeight / 2),
            type: 'node-connector',
            sourceNodeId: nodeId,
            connectorSide: _direction
        });
    }, [nodes, setContextMenu, toWorld]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const node = nodes.find(n => n.id === id);
        if (!node) return;

        setContextMenu({
            isOpen: true,
            x: e.clientX,
            y: e.clientY,
            ...toWorld(e.clientX, e.clientY),
            type: 'node-options',
            sourceNodeId: id
        });
    }, [nodes, setContextMenu, toWorld]);

    // ============================================================================
    // CONTEXT MENU ACTIONS
    // ============================================================================

    const handleContextMenuCreateAsset = useCallback(() => {
        if (contextMenu.sourceNodeId) {
            handleOpenCreateAsset(contextMenu.sourceNodeId);
        }
    }, [contextMenu.sourceNodeId, handleOpenCreateAsset]);

    const handleContextMenuSelect = useCallback((type: NodeType | 'DELETE') => {
        handleSelectTypeFromMenu(
            type,
            contextMenu,
            viewport,
            () => setContextMenu(prev => ({ ...prev, isOpen: false }))
        );
    }, [handleSelectTypeFromMenu, contextMenu, viewport, setContextMenu]);

    const handleToolbarAdd = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setContextMenu({
            isOpen: true,
            x: rect.right + 10,
            y: rect.top,
            ...toWorld(rect.right + 10, rect.top),
            type: 'global'
        });
    }, [setContextMenu, toWorld]);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleDoubleClick,
        handleGlobalContextMenu,
        handleAddNext,
        handleNodeContextMenu,
        handleContextMenuCreateAsset,
        handleContextMenuSelect,
        handleToolbarAdd
    };
};
