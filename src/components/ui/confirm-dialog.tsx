"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * A small, dependency-free confirmation modal for destructive actions
 * (delete a student, delete a van). Controlled via `open`. Backdrop click and
 * Escape both cancel — but not while `pending`, so a confirmed delete can't be
 * dismissed out from under itself mid-request.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={pending ? undefined : onCancel}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
