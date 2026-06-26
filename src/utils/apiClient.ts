/**
 * apiClient.ts
 *
 * Auth plumbing for the SPA. Rather than rewrite every scattered `fetch()`,
 * we install a global fetch interceptor that:
 *   - attaches `Authorization: Bearer <accessToken>` to same-origin /api calls
 *     (except the auth endpoints themselves),
 *   - on a 401, transparently tries the refresh token once and retries,
 *   - on refresh failure, clears tokens and notifies the app (-> logout).
 *
 * Token storage uses localStorage so sessions survive reloads (acceptable for
 * an internal-team tool). Swap to in-memory/sessionStorage to harden vs XSS.
 */

const AK = 'mc_access_token';
const RK = 'mc_refresh_token';

export const getAccessToken = (): string | null => { try { return localStorage.getItem(AK); } catch { return null; } };
export const getRefreshToken = (): string | null => { try { return localStorage.getItem(RK); } catch { return null; } };
export function setTokens(t: { accessToken?: string; refreshToken?: string }) {
    try {
        if (t.accessToken) localStorage.setItem(AK, t.accessToken);
        if (t.refreshToken) localStorage.setItem(RK, t.refreshToken);
    } catch { /* ignore */ }
}
export function clearTokens() { try { localStorage.removeItem(AK); localStorage.removeItem(RK); } catch { /* ignore */ } }

function urlPath(input: RequestInfo | URL): string {
    try {
        const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (raw.startsWith('/')) return raw;
        return new URL(raw, window.location.origin).pathname;
    } catch { return ''; }
}

let installed = false;
let refreshing: Promise<boolean> | null = null;

export function installAuthFetch(onAuthFailure: () => void) {
    if (installed) return;
    installed = true;
    const orig = window.fetch.bind(window);

    const tryRefresh = (): Promise<boolean> => {
        const rt = getRefreshToken();
        if (!rt) return Promise.resolve(false);
        if (!refreshing) {
            refreshing = orig('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: rt }),
            })
                .then(async (r) => {
                    if (!r.ok) return false;
                    const d = await r.json().catch(() => ({}));
                    if (d.accessToken) { setTokens({ accessToken: d.accessToken }); return true; }
                    return false;
                })
                .catch(() => false)
                .finally(() => { refreshing = null; });
        }
        return refreshing;
    };

    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = urlPath(input);
        const isApi = path.startsWith('/api');
        const isAuthEndpoint = /^\/api\/auth\/(login|refresh|register)$/.test(path);
        if (!isApi || isAuthEndpoint) return orig(input, init);

        const send = (token: string | null) => {
            const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
            if (token) headers.set('Authorization', `Bearer ${token}`);
            return orig(input, { ...init, headers });
        };

        let res = await send(getAccessToken());
        if (res.status === 401) {
            const ok = await tryRefresh();
            if (ok) {
                res = await send(getAccessToken());
            } else {
                clearTokens();
                onAuthFailure();
            }
        }
        return res;
    };
}
