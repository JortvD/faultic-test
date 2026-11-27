import { createContext, useContext } from 'react';
import { api, ApiError } from './data';

export const sessionChangedKey = 'fieldline-session-changed';

export function announceSessionChange() {
  try { localStorage.setItem(sessionChangedKey, String(Date.now()) + ":" + String(Math.random())); }
  catch { /* The server still validates the workspace if browser storage is unavailable. */ }
}

export const WorkspaceApi = createContext<typeof api | null>(null);

export function useWorkspaceApi() {
  const request = useContext(WorkspaceApi);
  if (!request) throw new Error('An active workspace is required.');
  return request;
}

export function bindWorkspace(workspaceId: number): typeof api {
  return async (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set('X-Fieldline-Workspace', String(workspaceId));
    try {
      return await api(path, { ...init, headers });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'workspace_changed')) {
        window.dispatchEvent(new CustomEvent(sessionChangedKey, { detail: workspaceId }));
      }
      throw error;
    }
  };
}
