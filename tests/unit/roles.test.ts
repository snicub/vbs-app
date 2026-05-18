import { describe, it, expect } from "vitest";
import {
  isStaff,
  isCoordinator,
  canCheckIn,
  canDriveVan,
} from "@/lib/auth/roles";

describe("role helpers", () => {
  it("isStaff: parent is not staff; everyone else is", () => {
    expect(isStaff("parent")).toBe(false);
    expect(isStaff("driver")).toBe(true);
    expect(isStaff("aide")).toBe(true);
    expect(isStaff("table_volunteer")).toBe(true);
    expect(isStaff("coordinator")).toBe(true);
    expect(isStaff("admin")).toBe(true);
  });

  it("isCoordinator: only coordinator + admin", () => {
    expect(isCoordinator("coordinator")).toBe(true);
    expect(isCoordinator("admin")).toBe(true);
    expect(isCoordinator("parent")).toBe(false);
    expect(isCoordinator("table_volunteer")).toBe(false);
    expect(isCoordinator("aide")).toBe(false);
  });

  it("canCheckIn: table_volunteer + coordinator + admin", () => {
    expect(canCheckIn("table_volunteer")).toBe(true);
    expect(canCheckIn("coordinator")).toBe(true);
    expect(canCheckIn("admin")).toBe(true);
    expect(canCheckIn("driver")).toBe(false);
    expect(canCheckIn("aide")).toBe(false);
    expect(canCheckIn("parent")).toBe(false);
  });

  it("canDriveVan: driver + aide + coordinator + admin", () => {
    expect(canDriveVan("driver")).toBe(true);
    expect(canDriveVan("aide")).toBe(true);
    expect(canDriveVan("coordinator")).toBe(true);
    expect(canDriveVan("admin")).toBe(true);
    expect(canDriveVan("table_volunteer")).toBe(false);
    expect(canDriveVan("parent")).toBe(false);
  });
});
