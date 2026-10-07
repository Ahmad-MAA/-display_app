/// <reference types="vite/client" />
import type { ControlApi, OutputApi } from '@shared/bridge';

declare global {
  interface Window {
    projectorDesk: ControlApi;
    projectorOutput: OutputApi;
  }
}

export {};
