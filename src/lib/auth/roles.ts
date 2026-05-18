import type { UserRole } from "@/types/domain";

export function isStaff(role: UserRole): boolean {
  return role !== "parent";
}

export function isCoordinator(role: UserRole): boolean {
  return role === "coordinator" || role === "admin";
}

export function canCheckIn(role: UserRole): boolean {
  return role === "table_volunteer" || role === "coordinator" || role === "admin";
}

export function canDriveVan(role: UserRole): boolean {
  return role === "driver" || role === "aide" || role === "coordinator" || role === "admin";
}

export type SessionUser = {
  id: string;
  email: string | null;
  role: UserRole;
  fullName: string;
};
