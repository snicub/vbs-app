"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Scan-to-check-in QR on each van's driver sheet — opens that van's on-board
 * check-in page (`/van/[vanId]`) when scanned, so the driver/aide gets to the
 * live board/drop-off screen straight from the paper sheet. White background so
 * it scans against the section's colored header band. Generated on-device.
 */
export function VanCheckInQr({ vanId, baseUrl }: { vanId: string; baseUrl: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(`${baseUrl}/van/${vanId}`, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(setUrl)
      .catch(() => {});
  }, [vanId, baseUrl]);

  return (
    <div
      className="shrink-0 flex flex-col items-center rounded-md bg-white p-1 text-center"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Scan to open this van's check-in page" className="size-16" />
      ) : (
        <div className="size-16" />
      )}
      <span className="mt-0.5 text-[9px] font-semibold leading-none text-black">
        Scan: check-in
      </span>
    </div>
  );
}
