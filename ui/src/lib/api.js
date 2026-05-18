const BASE = import.meta.env.VITE_API_URL ?? "";

export const apiUrl = (path) => `${BASE}${path}`;

export const getApiKey = () => localStorage.getItem("askhub_api_key") ?? "";
export const setApiKey = (key) => localStorage.setItem("askhub_api_key", key);
export const clearApiKey = () => localStorage.removeItem("askhub_api_key");

export const getWorkspaceName = () => localStorage.getItem("askhub_workspace_name") ?? "";
export const setWorkspaceName = (name) => localStorage.setItem("askhub_workspace_name", name);
export const clearWorkspaceName = () => localStorage.removeItem("askhub_workspace_name");

export function apiHeaders(extra = {}) {
  const key = getApiKey();
  return { ...extra, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
