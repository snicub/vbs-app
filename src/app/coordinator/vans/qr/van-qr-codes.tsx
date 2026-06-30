"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

type Van = { id: string; name: string; color: string };

/**
 * Printable QR codes — one per region — that open that van's rider page when
 * scanned. Generated locally (the access-granting URL never leaves the device).
 * Cut them out and post one in each van / hand to each aide.
 */
export function VanQrCodes({ vans, baseUrl }: { vans: Van[]; baseUrl: string }) {
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const v of vans) {
        out[v.id] = await QRCode.toDataURL(`${baseUrl}/van/${v.id}`, {
          width: 480,
          margin: 1,
          errorCorrectionLevel: "M",
        });
      }
      if (!cancelled) setCodes(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [vans, baseUrl]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">
          Each aide scans their region&apos;s code to open the van page. Print and post one
          in each van.
        </p>
        <Button onClick={() => window.print()}>Print QR codes</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 print:grid-cols-2">
        {vans.map((v) => (
          <div
            key={v.id}
            className="flex flex-col items-center rounded-xl border bg-card p-4 text-center break-inside-avoid"
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-block size-4 rounded-full border"
                style={{ backgroundColor: v.color }}
                aria-hidden
              />
              <span className="text-lg font-bold">{v.name}</span>
            </div>
            {codes[v.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={codes[v.id]} alt={`QR code for ${v.name}`} className="size-48" />
            ) : (
              <div className="flex size-48 items-center justify-center text-sm text-muted-foreground">
                generating…
              </div>
            )}
            <span className="mt-2 break-all text-[10px] text-muted-foreground">
              {baseUrl}/van/{v.id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
