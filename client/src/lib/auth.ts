const TOKEN_KEY = "fawazeer_adminToken";

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.success && data.token) {
    setAdminToken(data.token);
    return { success: true };
  }
  return { success: false, error: data.error || "خطأ" };
}

export async function verifyToken(): Promise<boolean> {
  const token = getAdminToken();
  if (!token) return false;
  try {
    const res = await fetch("/api/auth/verify", {
      headers: { "x-admin-token": token },
    });
    return res.ok;
  } catch {
    return false;
  }
}
