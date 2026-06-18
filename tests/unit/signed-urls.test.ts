import { describe, it, expect, vi, beforeEach } from "vitest";

// signed-url.ts is `import "server-only"` + hits the Supabase admin client.
// Stub both so the PURE path-mapping logic is unit-testable: the batch helper
// runs on every ~100-kid roster render, and its null-safety/dedupe/backfill is
// exactly the kind of "looks fine, silently wrong" code that needs pinning.
const { createSignedUrls, createSignedUrl } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrls, createSignedUrl }) },
  }),
}));

import { signedUrlsFor, signedUrlFor } from "@/lib/storage/signed-url";

beforeEach(() => {
  createSignedUrls.mockReset();
  createSignedUrl.mockReset();
});

describe("signedUrlsFor — batch path mapping", () => {
  it("dedupes paths and calls the API once with the unique set, order preserved", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "a", signedUrl: "u-a", error: null },
        { path: "b", signedUrl: "u-b", error: null },
      ],
      error: null,
    });
    const map = await signedUrlsFor("student-photos", ["a", "a", "b", "a"]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["a", "b"], expect.any(Number));
    expect(map.get("a")).toBe("u-a");
    expect(map.get("b")).toBe("u-b");
  });

  it("maps a per-item failure to null but keeps the key present", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "a", signedUrl: "u-a", error: null },
        { path: "b", signedUrl: null, error: "Object not found" },
      ],
      error: null,
    });
    const map = await signedUrlsFor("student-photos", ["a", "b"]);
    expect(map.get("a")).toBe("u-a");
    expect(map.has("b")).toBe(true);
    expect(map.get("b")).toBeNull();
  });

  it("maps a null signedUrl with NO error to null, never undefined (the latent edge)", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "c", signedUrl: null, error: null }],
      error: null,
    });
    const map = await signedUrlsFor("student-photos", ["c"]);
    expect(map.get("c")).toBeNull();
  });

  it("backfills a path the API silently omitted with null (the stuck-undefined guard)", async () => {
    // Caller asked for a+b; API only returned a. b must still be a key → null.
    createSignedUrls.mockResolvedValue({
      data: [{ path: "a", signedUrl: "u-a", error: null }],
      error: null,
    });
    const map = await signedUrlsFor("student-photos", ["a", "b"]);
    expect(map.get("a")).toBe("u-a");
    expect(map.has("b")).toBe(true);
    expect(map.get("b")).toBeNull();
  });

  it("maps every requested path to null on a top-level API error", async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: { message: "bucket down" } });
    const map = await signedUrlsFor("student-photos", ["a", "b"]);
    expect(map.get("a")).toBeNull();
    expect(map.get("b")).toBeNull();
    expect(map.size).toBe(2);
  });

  it("filters null/undefined/empty paths before calling the API", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "x", signedUrl: "u-x", error: null }],
      error: null,
    });
    const map = await signedUrlsFor("student-photos", [null, undefined, "", "x"]);
    expect(createSignedUrls).toHaveBeenCalledWith(["x"], expect.any(Number));
    expect(map.get("x")).toBe("u-x");
    expect(map.has("")).toBe(false);
  });

  it("short-circuits with an empty map and NO API call when nothing is signable", async () => {
    const empty = await signedUrlsFor("student-photos", []);
    expect(empty.size).toBe(0);
    const allNull = await signedUrlsFor("student-photos", [null, undefined, ""]);
    expect(allNull.size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("passes a custom TTL through to the API", async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });
    await signedUrlsFor("wristbands", ["a"], 42);
    expect(createSignedUrls).toHaveBeenCalledWith(["a"], 42);
  });
});

describe("signedUrlFor — single object", () => {
  it("returns null and does NOT call the API for a null path", async () => {
    const url = await signedUrlFor("student-photos", null);
    expect(url).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns null on an API error (missing object / misconfigured bucket)", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });
    const url = await signedUrlFor("student-photos", "a/b.jpg");
    expect(url).toBeNull();
  });

  it("returns the signed URL on success and forwards the TTL", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "u" }, error: null });
    const url = await signedUrlFor("student-photos", "a/b.jpg", 99);
    expect(url).toBe("u");
    expect(createSignedUrl).toHaveBeenCalledWith("a/b.jpg", 99);
  });
});
