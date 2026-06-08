/**
 * Undo/redo for Studio set builder — automation curves, deck mixes, timeline layout.
 */
import { create } from "zustand";
import type { DeckMix } from "../lib/deckMixEngine";
import type { TrackAutomationState } from "./studioAutomationStore";
import type { SetCard } from "./setBuilderStore";
import type { SetLocator } from "./setLocatorStore";
import { useStudioAutomationStore } from "./studioAutomationStore";
import { useStudioDeckStore } from "./studioDeckStore";
import { getActiveUserSet, useSetBuilderStore } from "./setBuilderStore";
import { useSetLocatorStore } from "./setLocatorStore";

const MAX_HISTORY = 80;

export interface UndoSnapshot {
  automation: Record<number, TrackAutomationState>;
  deckMixes: Record<number, DeckMix>;
  setCards: SetCard[];
  locators: SetLocator[];
}

let restoring = false;
let gestureDepth = 0;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotsEqual(a: UndoSnapshot, b: UndoSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function createSnapshot(): UndoSnapshot {
  const { tracks } = useStudioAutomationStore.getState();
  const { mixes } = useStudioDeckStore.getState();
  const setState = useSetBuilderStore.getState();
  const cards = getActiveUserSet(setState).cards;
  return {
    automation: clone(tracks),
    deckMixes: clone(mixes),
    setCards: clone(cards),
    locators: clone(useSetLocatorStore.getState().locators),
  };
}

function applySnapshot(snapshot: UndoSnapshot) {
  restoring = true;
  useStudioAutomationStore.setState({ tracks: clone(snapshot.automation) });
  useStudioDeckStore.getState().setMixes(clone(snapshot.deckMixes));
  useSetBuilderStore.setState(s => ({
    sets: s.sets.map(userSet =>
      userSet.id === s.activeSetId
        ? { ...userSet, cards: clone(snapshot.setCards) }
        : userSet,
    ),
  }));
  useSetLocatorStore.getState().replaceLocators(clone(snapshot.locators));
  restoring = false;
}

function isAutomationRecording(): boolean {
  const { isRecording, editMode } = useStudioAutomationStore.getState();
  return isRecording && editMode === "record";
}

export function isRestoringUndo(): boolean {
  return restoring;
}

export function isUndoGestureActive(): boolean {
  return gestureDepth > 0;
}

/** Snapshot current state before a discrete edit. */
export function captureUndoState() {
  if (restoring || gestureDepth > 0 || isAutomationRecording()) return;
  useUndoStore.getState().pushSnapshot(createSnapshot());
}

/** Group rapid edits (knob drag, automation drag, track move) into one undo step. */
export function beginUndoGesture() {
  if (restoring || isAutomationRecording()) return;
  if (gestureDepth === 0) {
    useUndoStore.getState().pushSnapshot(createSnapshot());
  }
  gestureDepth++;
}

export function endUndoGesture() {
  gestureDepth = Math.max(0, gestureDepth - 1);
}

interface UndoStoreState {
  past: UndoSnapshot[];
  future: UndoSnapshot[];
  pushSnapshot: (snapshot: UndoSnapshot) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useUndoStore = create<UndoStoreState>((set, get) => ({
  past: [],
  future: [],

  pushSnapshot: (snapshot) => {
    const { past } = get();
    if (past.length > 0 && snapshotsEqual(past[past.length - 1], snapshot)) return;
    const next = [...past, snapshot];
    if (next.length > MAX_HISTORY) next.shift();
    set({ past: next, future: [] });
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const current = createSnapshot();
    const previous = past[past.length - 1];
    applySnapshot(previous);
    set({
      past: past.slice(0, -1),
      future: [current, ...future],
    });
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const current = createSnapshot();
    const next = future[0];
    applySnapshot(next);
    set({
      past: [...past, current],
      future: future.slice(1),
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clear: () => set({ past: [], future: [] }),
}));
