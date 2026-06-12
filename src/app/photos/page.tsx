import { env } from "@/lib/env";
import { buttonVariants } from "@/components/ui/button";
import { ExternalLinkIcon, UploadIcon, ImageIcon } from "lucide-react";

export const metadata = { title: "Photos — VBS" };

/**
 * Accept any of these as the env var value and pull out the bare folder ID:
 *   - ABC123                                              (already an ID)
 *   - https://drive.google.com/drive/folders/ABC123       (folder URL)
 *   - https://drive.google.com/drive/folders/ABC123?usp=sharing
 *   - https://drive.google.com/drive/u/0/folders/ABC123
 */
function extractDriveFolderId(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const match = v.match(/folders\/([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];
  // Bare ID — alphanumeric with - and _, typically 25-44 chars
  if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return v;
  return null;
}

/**
 * VBS photo + video hub. Embeds a single Google Drive folder so staff can
 * browse + upload media without us building a moderation pipeline. The
 * folder is configured via NEXT_PUBLIC_DRIVE_FOLDER_ID and must be
 * shared "Anyone with the link → Editor" for upload-without-login to work.
 */
export default function PhotosPage() {
  const folderId = extractDriveFolderId(env.NEXT_PUBLIC_DRIVE_FOLDER_ID);

  if (!folderId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Photos</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm space-y-3">
          <p className="font-medium">Not configured yet.</p>
          <p className="text-muted-foreground">
            A coordinator needs to add the Google Drive folder ID to{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              NEXT_PUBLIC_DRIVE_FOLDER_ID
            </code>{" "}
            in <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.env.local</code>.
          </p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Create a Drive folder for VBS photos &amp; video.</li>
            <li>Share → &quot;Anyone with the link&quot; → set to <strong>Editor</strong>.</li>
            <li>Copy the folder ID from the share URL (the bit after <code className="font-mono text-xs">/folders/</code>).</li>
            <li>Paste it into <code className="font-mono text-xs">.env.local</code> and restart the dev server.</li>
          </ol>
        </div>
      </main>
    );
  }

  const driveUrl = `https://drive.google.com/drive/folders/${folderId}`;
  const embedUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`;

  return (
    <main className="mx-auto max-w-5xl px-3 sm:px-4 py-4 sm:py-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ImageIcon className="size-6" /> Photos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Staff drop photos and video here during VBS. Anything you upload
            shows up here for everyone.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "sm" })}
          >
            <UploadIcon /> Upload
          </a>
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <ExternalLinkIcon /> Open in Drive
          </a>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden bg-card">
        <iframe
          src={embedUrl}
          title="VBS Photos & Video"
          className="w-full block"
          style={{ height: "min(75dvh, 800px)", border: 0 }}
          allow="autoplay"
        />
      </div>

      <details className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer font-medium">
          Embed not loading? Click to debug
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            If the iframe shows a Google 404, the folder isn&apos;t shared
            publicly. Open the folder URL below in a new tab — if you see
            the same 404 there too, fix the sharing in Drive:
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Right-click the folder in Drive → <strong>Share</strong></li>
            <li>Under &quot;General access&quot;, change &quot;Restricted&quot; → <strong>Anyone with the link</strong></li>
            <li>Set role to <strong>Editor</strong> (so volunteers can upload without signing in)</li>
            <li>Click <strong>Done</strong> and refresh this page</li>
          </ol>
          <div className="font-mono break-all rounded bg-background border px-2 py-1.5 text-[11px]">
            ID: {folderId}
            <br />
            Embed: <a href={embedUrl} target="_blank" rel="noopener noreferrer" className="underline">{embedUrl}</a>
            <br />
            Folder: <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="underline">{driveUrl}</a>
          </div>
        </div>
      </details>
    </main>
  );
}
