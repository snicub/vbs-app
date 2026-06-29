"use client";

import { Button } from "@/components/ui/button";
import { PrinterIcon } from "lucide-react";

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <PrinterIcon /> Print
    </Button>
  );
}
