const BASE = import.meta.env.VITE_API_URL ?? "";

export const apiUrl = (path) => `${BASE}${path}`;

export const getApiKey = () => localStorage.getItem("askhub_api_key") ?? "";
export const setApiKey = (key) => localStorage.setItem("askhub_api_key", key);
export const clearApiKey = () => localStorage.removeItem("askhub_api_key");

export function apiHeaders(extra = {}) {
  const key = getApiKey();
  return { ...extra, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
