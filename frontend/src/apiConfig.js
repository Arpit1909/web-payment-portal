const raw = import.meta.env.VITE_API_URL;

export const API_BASE =
    raw == null || String(raw).trim() === ''
        ? ''
        : String(raw).replace(/\/$/, '');

export function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return API_BASE ? `${API_BASE}${p}` : p;
}
