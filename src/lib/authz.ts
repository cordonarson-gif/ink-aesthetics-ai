import type { AppUser } from "@/lib/types";

export function isAdminUser(user: Pick<AppUser, "id" | "username"> | null | undefined): boolean {
  if (!user) return false;
  const normalized = (user.username || "").trim().toLowerCase();
  return user.id === "root" || normalized === "admin";
}

