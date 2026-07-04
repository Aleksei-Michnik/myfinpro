# RCA — 6.18.1.4-hotfix: Auth 401-loop + SSE reconnect storm + stale edit dialog

## Confirmed Root Causes

### RC-1: No proactive token refresh — auth 401-loop after JWT TTL (Symptoms 1 & 2)

**Evidence:**

The frontend's [`auth-context.tsx`](../apps/web/src/lib/auth/auth-context.tsx:59) performs a token refresh **only once on mount** (the `silentRefresh` inside `useEffect([], [])`). After that initial refresh, there is **no mechanism** to obtain a new access token before or after it expires.

```tsx
// apps/web/src/lib/auth/auth-context.tsx:59-82
useEffect(() => {
  const silentRefresh = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { ... });
      if (res.ok) { setUser(...); setAccessToken(...); }
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  };
  silentRefresh();
}, []);  // ← runs ONCE on mount, never again
```

The [`api-client.ts`](../apps/web/src/lib/api-client.ts:27) is a thin fetch wrapper with **no 401 interceptor/retry logic**:

```tsx
// apps/web/src/lib/api-client.ts:39-41
if (!response.ok) {
  const errorBody = await response.json().catch(() => ({ message: 'Request failed' }));
  throw new Error(...);  // ← no refresh attempt, just throws
}
```

The [`payment-context.tsx`](../apps/web/src/lib/payment/payment-context.tsx:167) uses `getAccessToken()` which returns the **stale in-memory token**:

```tsx
// apps/web/src/lib/payment/payment-context.tsx:167-174
const authHeaders = useCallback((): HeadersInit => {
  const token = getAccessToken(); // ← returns stale React state after 15 min
  if (!token) throw new Error('Not authenticated');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}, [getAccessToken]);
```

**Timeline of failure:**

1. User logs in → `accessToken` stored in React state (15-min TTL), `access_token` cookie set (15-min MaxAge)
2. For 15 minutes, everything works
3. After 15 min: in-memory token expired, cookie expired
4. All API calls send expired Bearer header → 401
5. All EventSource reconnects send expired cookie → 401
6. No recovery path until page refresh triggers `silentRefresh()`

### RC-2: Realtime reconnect amplifies the 401 storm without triggering refresh (Symptom 2)

**Evidence:**

The [`realtime-context.tsx`](../apps/web/src/lib/realtime/realtime-context.tsx:108) `onerror` handler reconnects blindly with exponential backoff — it does **not** attempt a token refresh before reconnecting:

```tsx
// apps/web/src/lib/realtime/realtime-context.tsx:108-121
es.onerror = () => {
  es.close();
  sourceRef.current = null;
  setStatus('reconnecting');
  const delay = backoffRef.current;
  backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
  reconnectTimerRef.current = setTimeout(() => {
    reconnectTimerRef.current = null;
    connect(); // ← reconnects with same expired cookie, guaranteed 401
  }, delay);
};
```

The EventSource sends `withCredentials: true` so it relies on the `access_token` cookie ([line 91](../apps/web/src/lib/realtime/realtime-context.tsx:91)). Once the cookie's 15-min MaxAge is reached, the browser stops sending it. Every reconnect attempt fails immediately with 401, and the provider keeps retrying up to 30s backoff — producing the observed "10+ stream 401 requests" pattern.

### RC-3: Edit dialog uses stale prop data — no server refetch (Symptom 3)

**Evidence:**

[`PaymentFormDialog.tsx`](../apps/web/src/components/payment/PaymentFormDialog.tsx:259) builds its initial form state from the `payment` prop:

```tsx
// apps/web/src/components/payment/PaymentFormDialog.tsx:259-277
const initialState = useMemo<FormState>(() => {
  if (mode === 'edit' && payment) {
    return paymentToState(payment);  // ← prop data, never refetched
  }
  ...
}, [mode, payment?.id]);
```

There is **no** `getPayment(id)` fetch anywhere in the dialog component. If the payment was modified elsewhere (another tab, another device, or by a schedule), the edit form shows stale data from the list cache.

---

## Eliminated Hypotheses

### H1 — `cookie-parser` not installed or not registered: ❌ DISPROVED

- [`apps/api/package.json:47`](../apps/api/package.json:47): `"cookie-parser": "^1.4.7"` — present in dependencies
- [`apps/api/src/main.ts:4`](../apps/api/src/main.ts:4): `import cookieParser from 'cookie-parser'` — imported
- [`apps/api/src/main.ts:76`](../apps/api/src/main.ts:76): `app.use(cookieParser())` — registered before all routes

### H2 — Refresh endpoint doesn't set `access_token` cookie: ❌ DISPROVED

- [`auth.controller.ts:129`](../apps/api/src/auth/auth.controller.ts:129): `@Res({ passthrough: true }) response: Response` — correct decorator
- [`auth.service.ts:283`](../apps/api/src/auth/auth.service.ts:283): `setAuthCookie(response, accessToken)` — called in `refreshTokens`
- The cookie IS set on every successful refresh. The problem is that **the frontend never calls refresh after mount**.

### H3 — Cookie MaxAge doesn't match JWT TTL: ❌ DISPROVED

- Cookie MaxAge: `15 * 60 = 900` seconds ([`auth-cookie.ts:16`](../apps/api/src/auth/utils/auth-cookie.ts:16))
- JWT TTL: `expiresIn: configService.get('JWT_EXPIRATION', '15m')` ([`auth.module.ts:38`](../apps/api/src/auth/auth.module.ts:38))
- Both are 15 minutes — perfectly matched.

### H5 — `RealtimeAuthGuard` crashes on missing `req.cookies`: ❌ DISPROVED

- [`realtime-auth.guard.ts:35`](../apps/api/src/realtime/realtime-auth.guard.ts:35): `request.cookies?.access_token` — optional chaining prevents crash
- Falls through to Bearer fallback (line 39); if both paths fail, returns `null` cleanly and throws `UnauthorizedException` — no unhandled crash.

---

## Fix Plan (Phase B)

### Fix 1: Proactive token refresh cycle in `auth-context.tsx`

Add a `setInterval` that calls `POST /auth/refresh` at ~80% of the JWT TTL (12 minutes for a 15-min token). On success, update `accessToken` state and the `access_token` cookie is automatically refreshed by the server's `setAuthCookie` call. On failure, trigger logout.

**Files:** `apps/web/src/lib/auth/auth-context.tsx`

**Scope:**

- Add `useEffect` with `setInterval(refreshTokens, 12 * 60 * 1000)` while authenticated
- Clear interval on unmount or logout
- On refresh failure (network error or 401 from refresh endpoint), call `logout()`

### Fix 2: Realtime provider — refresh-then-reconnect on 401

Make the `onerror` handler in `realtime-context.tsx` first attempt a token refresh before reconnecting. If the refresh succeeds (cookie is now valid), proceed with reconnection. If it fails, stop reconnecting and emit a `disconnected` status.

**Files:** `apps/web/src/lib/realtime/realtime-context.tsx`

**Scope:**

- Accept a `refreshFn: () => Promise<boolean>` prop (or pull from auth context)
- On error, call `refreshFn()` before scheduling the next `connect()`
- If refresh fails → set status to `'disconnected'`, do not retry
- Prevents the 401 storm entirely

### Fix 3: Edit dialog — fetch fresh data on open

When `PaymentFormDialog` opens in edit mode, issue `getPayment(id)` to load the latest server state before populating the form.

**Files:** `apps/web/src/components/payment/PaymentFormDialog.tsx`

**Scope:**

- Add a `useEffect` that calls `getPayment(payment.id)` when `open && mode === 'edit'`
- Show a brief loading skeleton while the fetch is in-flight
- On success, override the `initialState` with fresh data
- On failure, fall back to the prop data (current behaviour) with an info banner

---

## Risk Assessment

| Fix                                     | Risk                                      | Mitigation                                                                                                    |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fix 1 (proactive refresh)               | Refresh interval races with multiple tabs | Use `BroadcastChannel` or accept that each tab independently refreshes (server handles token rotation safely) |
| Fix 2 (realtime refresh-then-reconnect) | Circular dependency auth↔realtime         | Pass refresh as a callback prop rather than importing AuthContext inside RealtimeProvider                     |
| Fix 3 (edit dialog refetch)             | Extra network round-trip on open          | Skeleton is brief (~50 ms on LAN); UX improvement outweighs the latency                                       |
