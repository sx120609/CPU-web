import type { WorkshopSDK } from "./sdk.js";
export interface GameShellOptions {
  container: HTMLElement;
  sdk: WorkshopSDK;
  title: string;
  description: string;
  stage: HTMLElement;
  settings?: { id: string; label: string; default?: boolean }[];
  onStart?: (settings: Record<string, boolean>) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}
export interface GameShell {
  ready: Promise<void>;
  readonly phase: "menu" | "playing" | "paused" | "over";
  start(): void;
  pause(): void;
  resume(): void;
  setScore(score: number): void;
  setStatus(text: string): void;
  end(result: { score: number; summary?: string }): void;
  destroy(): Promise<unknown>;
}
export function createGameShell(options: GameShellOptions): GameShell;
export function createToolShell(options: {
  container: HTMLElement;
  sdk: WorkshopSDK;
  title: string;
  description: string;
  input: HTMLElement;
  output: HTMLElement;
  actionLabel?: string;
  run: (context: {
    signal: AbortSignal;
    onProgress(value?: number, message?: string): void;
  }) => void | Promise<void>;
}): { ready: Promise<void>; cancel(): void; destroy(): void };
