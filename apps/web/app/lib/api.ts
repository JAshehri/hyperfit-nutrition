import type { AppData } from "./domain";

export type AppRole = "CLIENT" | "DOCTOR" | "ADMIN";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: "ACTIVE" | "SUSPENDED";
  must_change_password: boolean;
};

export type ManagedUser = AuthUser & {
  created_at: string;
  last_login_at: string | null;
  license_number?: string | null;
  specialty?: string | null;
  age?: number | null;
  sex?: "MALE" | "FEMALE" | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  activity_level?: string | null;
  default_goal?: string | null;
  medical_notes?: string | null;
};

export type CreateManagedUser = {
  email: string;
  password: string;
  full_name: string;
  role: AppRole;
  license_number?: string;
  specialty?: string;
  age?: number;
  sex?: "MALE" | "FEMALE";
  height_cm?: number;
  weight_kg?: number;
  body_fat_pct?: number;
  activity_level?: string;
  default_goal?: string;
  medical_notes?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";
const TOKEN_KEY = "hyperfit-access-token";

function token() {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const accessToken = token();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = "تعذر إكمال العملية";
    try {
      const body = await response.json();
      message = typeof body.detail === "string" ? body.detail : body.message_ar ?? message;
    } catch { /* keep safe fallback */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  hasToken: () => Boolean(token()),
  clearToken: () => window.sessionStorage.removeItem(TOKEN_KEY),
  async login(email: string, password: string) {
    const result = await request<{ access_token: string; user: AuthUser }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    window.sessionStorage.setItem(TOKEN_KEY, result.access_token);
    return result.user;
  },
  me: () => request<{ user: AuthUser }>("/auth/me"),
  updateProfile: (fullName: string, email: string) => request<AuthUser>("/auth/me", {
    method: "PATCH", body: JSON.stringify({ full_name: fullName, email }),
  }),
  async logout() {
    try { await request<void>("/auth/logout", { method: "POST" }); } catch { /* an expired/revoked session is already logged out */ }
    finally { api.clearToken(); }
  },
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/auth/change-password", {
    method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }),
  loadState: () => request<{ data: AppData | null; version: number }>("/state"),
  saveState: (data: AppData) => request<{ version: number }>("/state", {
    method: "PUT", body: JSON.stringify({ data }),
  }),
  approvePlan: (planId: string) => request<{ data: AppData; version: number }>(`/state/plans/${planId}/approve`, { method: "POST" }),
  setMealCompleted: (planId: string, mealId: string, completed: boolean) => request<{ version: number }>("/state/meal-completion", {
    method: "PATCH", body: JSON.stringify({ plan_id: planId, meal_id: mealId, completed }),
  }),
  replaceClientMeal: (planId: string, mealId: string) => request<{ version: number; meal: import("./domain").GeneratedMeal }>("/state/meal-alternative", {
    method: "PATCH", body: JSON.stringify({ plan_id: planId, meal_id: mealId }),
  }),
  listUsers: () => request<ManagedUser[]>("/admin/users"),
  createUser: (payload: CreateManagedUser) => request<AuthUser>("/admin/users", {
    method: "POST", body: JSON.stringify(payload),
  }),
  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  setUserEnabled: (id: string, enabled: boolean) => request<{ status: string }>(`/admin/users/${id}/status?enabled=${enabled}`, { method: "PATCH" }),
};
