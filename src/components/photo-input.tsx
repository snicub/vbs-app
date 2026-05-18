"use client";

import { useState } from "react";
import { resizeImageFile } from "@/lib/image/resize";
import { Button } from "@/components/ui/button";

export type PhotoValue = {
  blob: Blob;
  previewUrl: string;
} | null;

/**
 * Single-photo upload control. Handles file selection, client-side resize
 * to ≤800px JPEG, preview, and clear. Wraps the file input itself so the
 * parent only deals with `value` + `onChange`.
 */
export function PhotoInput({
  value,
  onChange,
  required,
}: {
  value: PhotoValue;
  onChange: (next: PhotoValue) => void;
  required?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      const blob = await resizeImageFile(file, { maxDimension: 800, quality: 0.85 });
      if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
      onChange({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="h-20 w-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.previewUrl} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">No photo</span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <label className="inline-block">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
              onChange={onFile}
            />
            {required && !value && (
              <span className="ml-1 text-xs text-destructive">*required</span>
            )}
          </label>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Remove
            </Button>
          )}
          {busy && <p className="text-xs text-muted-foreground">Resizing…</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
