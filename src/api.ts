import type { FishingLog, Forecast, LocationPoint, SavedSpot, TideSource } from "./types";

export type AuthUser = { id: string; username: string; role: "ADMIN" | "USER" };
export type Invitation = { id: string; createdAtUtc: string; expiresAtUtc: string | null; maxUses: number; uses: number; revokedAtUtc: string | null; createdByUsername: string };

async function json<T>(response: Response, message: string) {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(body?.reason ?? message);
  }
  return response.json() as Promise<T>;
}

const authFetch = (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, { credentials: "same-origin", ...init });
const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const waterTypeForSpot = (spotType: string) => spotType === "freshwater" ? "freshwater" : spotType === "estuary" ? "estuary" : spotType === "wharf" ? "estuary_or_harbour" : "coastal";

export async function getCurrentUser() { return json<{ authenticated: boolean; user: AuthUser | null }>(await authFetch("/api/auth/me"), "Unable to read login state"); }
export async function login(username: string, password: string) { return json<{ authenticated: true; user: AuthUser }>(await authFetch("/api/auth/login", jsonPost({ username, password })), "Login failed"); }
export async function register(username: string, password: string, invitationCode: string) { return json<{ authenticated: true; user: AuthUser }>(await authFetch("/api/auth/register", jsonPost({ username, password, invitationCode })), "Registration failed"); }
export async function logout() { return json<{ status: string }>(await authFetch("/api/auth/logout", { method: "POST" }), "Logout failed"); }
export async function getInvitations() { return json<{ invitations: Invitation[] }>(await authFetch("/api/admin/invitations"), "Unable to read invitations"); }
export async function createInvitation(maxUses: number, expiresAtUtc?: string) { return json<{ invitation: Invitation & { code: string } }>(await authFetch("/api/admin/invitations", jsonPost({ maxUses, expiresAtUtc: expiresAtUtc || undefined })), "Unable to create invitation"); }
export async function revokeInvitation(id: string) { return json<{ status: string }>(await authFetch(`/api/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" }), "Unable to revoke invitation"); }

export async function searchLocations(query: string, focus?: { latitude: number; longitude: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  if (focus) { params.set("lat", String(focus.latitude)); params.set("lon", String(focus.longitude)); }
  return (await json<{ data: LocationPoint[] }>(await fetch(`/api/geocode/search?${params}`, { signal }), "Address search unavailable")).data;
}
export async function reverseLocation(latitude: number, longitude: number, signal?: AbortSignal) {
  return (await json<{ data: LocationPoint | null }>(await fetch(`/api/geocode/reverse?lat=${latitude}&lon=${longitude}`, { signal }), "Reverse geocoding failed")).data;
}
export async function getForecast(point: LocationPoint, spotType: string, fishingMethod: string, preferredTideSource: TideSource = "BOM_OFFICIAL") {
  const params = new URLSearchParams({ spotId: point.id, lat: String(point.latitude), lon: String(point.longitude), name: point.name, address: point.address, state: point.state, timezone: point.timezone, spotType, waterType: waterTypeForSpot(spotType), fishingMethod, preferredTideSource });
  return json<Forecast>(await authFetch(`/api/forecast?${params}`), "Forecast service unavailable");
}
export async function getSpots() { return json<SavedSpot[]>(await authFetch("/api/spots"), "Unable to read saved spots"); }
export async function saveSpot(point: LocationPoint, spotType: string, fishingMethod: string) { return json<SavedSpot>(await authFetch("/api/spots", jsonPost({ ...point, spotType, fishingMethod, waterType: waterTypeForSpot(spotType) })), "Unable to save spot"); }
export async function saveEnvironmentPreferences(spotId: string, preferredTideSource: TideSource, options: Record<string, unknown> = {}) { return json<{ status: string }>(await authFetch(`/api/spots/${encodeURIComponent(spotId)}/environment-preferences`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferredTideSource, ...options }) }), "Unable to save tide settings"); }
export async function getLogs() { return json<FishingLog[]>(await authFetch("/api/logs"), "Unable to read logs"); }
export async function saveLog(input: Record<string, unknown>) { return json<{ id: string }>(await authFetch("/api/logs", jsonPost(input)), "Unable to save fishing log"); }
export async function getAnalytics() { return json<{ sessions: number; catches: number; bites: number; rating: number; blankRate: number; insufficientSample: boolean }>(await authFetch("/api/analytics"), "Unable to read analytics"); }
export async function getSystemStatus() { return json<Record<string, unknown>>(await fetch("/api/system-status"), "Unable to read system status"); }
