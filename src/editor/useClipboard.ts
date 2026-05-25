// src/editor/useClipboard.ts
// Tastatur-Shortcuts fuer Copy/Paste/Delete im Editor.
//
// Workflow:
//   - Cmd/Ctrl+C: ausgewaehlte Nodes ins Clipboard
//   - Cmd/Ctrl+V: einfuegen (neue IDs, Position leicht versetzt)
//   - Cmd/Ctrl+D: duplizieren (= copy + paste in einem Schritt)
//   - Delete/Backspace: ausgewaehlte Nodes loeschen
//
// Selektion wird ueber useNodes() aus @xyflow/react gelesen — zuverlaessiger
// als DOM-Klassen-Queries, die von React-Flow-Versionen abhaengen.

import { useCallback, useEffect, useRef } from 'react';
import { useNodes, useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../state/graphStore';
import type { GraphEdge, GraphNode } from '../graph/graphTypes';

interface ClipboardData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Modul-Level Clipboard (ueberlebt Re-Mounts der Komponente, nicht Tab-Wechsel).
let clipboard: ClipboardData | null = null;

export function useClipboardShortcuts(): void {
  const doc = useGraphStore((s) => s.doc);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeNode = useGraphStore((s) => s.removeNode);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);

  const { setNodes } = useReactFlow();

  // React Flow's eigene Selektion — zuverlaessiger als DOM-Queries
  const rfNodes = useNodes();
  const rfNodesRef = useRef(rfNodes);
  rfNodesRef.current = rfNodes;

  const copy = useCallback(() => {
    const selectedIds = rfNodesRef.current.filter((n) => n.selected).map((n) => n.id);
    if (selectedIds.length === 0) return;

    const selectedNodes = doc.nodes.filter((n) => selectedIds.includes(n.id));
    // Edges, die beide Endpunkte in der Selektion haben - sonst kopieren wir
    // Verbindungen, die im Ziel nicht zusammenpassen.
    const selectedEdges = doc.edges.filter(
      (e) => selectedIds.includes(e.source) && selectedIds.includes(e.target),
    );
    clipboard = {
      nodes: structuredClone(selectedNodes),
      edges: structuredClone(selectedEdges),
    };
    flashStatus(`${selectedNodes.length} Node(s) kopiert`);
  }, [doc]);

  const paste = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) return;

    // Neue IDs vergeben, Edges mit gemappten IDs anlegen.
    const idMap = new Map<string, string>();
    const positionOffset = 32;

    // Erst Nodes erzeugen, mappen
    for (const oldNode of clipboard.nodes) {
      const newId = addNode(
        oldNode.type,
        { x: oldNode.position.x + positionOffset, y: oldNode.position.y + positionOffset },
        oldNode.params,   // Params direkt mitgeben
      );
      idMap.set(oldNode.id, newId);
    }
    // Dann Edges
    for (const oldEdge of clipboard.edges) {
      const newSrc = idMap.get(oldEdge.source);
      const newTgt = idMap.get(oldEdge.target);
      if (!newSrc || !newTgt) continue;
      addEdge({
        source: newSrc,
        sourceHandle: oldEdge.sourceHandle,
        target: newTgt,
        targetHandle: oldEdge.targetHandle,
      });
    }
    flashStatus(`${clipboard.nodes.length} Node(s) eingefuegt`);
  }, [addNode, addEdge]);

  const duplicate = useCallback(() => {
    copy();
    // Im naechsten Tick einfuegen - sonst sieht React Flow den Selection-Wechsel nicht
    queueMicrotask(() => paste());
  }, [copy, paste]);

  const deleteSelected = useCallback(() => {
    const selectedIds = rfNodesRef.current.filter((n) => n.selected).map((n) => n.id);
    for (const id of selectedIds) removeNode(id);
    if (selectedIds.length > 0) flashStatus(`${selectedIds.length} Node(s) geloescht`);
  }, [removeNode]);

  const selectAll = useCallback(() => {
    setNodes((nodes) => nodes.map((n) => ({ ...n, selected: true })));
    flashStatus('Alle Nodes ausgewählt');
  }, [setNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && e.key === 'a') { e.preventDefault(); selectAll(); }
      else if (mod && e.key === 'c') { e.preventDefault(); copy(); }
      else if (mod && e.key === 'v') { e.preventDefault(); paste(); }
      else if (mod && e.key === 'd') { e.preventDefault(); duplicate(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        const sel = rfNodesRef.current.filter((n) => n.selected);
        if (sel.length > 0) { e.preventDefault(); deleteSelected(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy, paste, duplicate, deleteSelected, undo, redo, selectAll]);
}

/** Kleines Toast-aehnliches Feedback - schreibt in die Diagnostik. */
function flashStatus(message: string): void {
  // Wir nehmen den status-store import lazy, um Zirkulariataeten zu vermeiden
  import('../state/statusStore').then((m) => m.useStatusStore.getState().log('info', message));
}
