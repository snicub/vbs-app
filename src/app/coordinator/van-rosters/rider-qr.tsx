"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * A scan-to-navigate QR on the printed driver sheet — opens Google Maps directions
 * straight to the rider's home coordinate (works for a pasted lat/lng pickup point
 * too). Generated locally so nothing leaves the device.
 */
export function RiderQr({ lat, lng }: { lat: number; lng: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const dest = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    QRCode.toDataURL(dest, { width: 160, margin: 0, errorCorrectionLevel: "M" })
      .then(setUrl)
      .catch(() => {});
  }, [lat, lng]);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="Scan to navigate" className="size-16 shrink-0" title="Scan to navigate" />
  );
}
