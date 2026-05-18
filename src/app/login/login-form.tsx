"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { sendMagicLink, verifyEmailOtp } from "@/server-actions/auth";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pendingSend, setPendingSend] = useState(false);
  const [sent, setSent] = useState(false);

  const [otp, setOtp] = useState("");
  const [pendingVerify, setPendingVerify] = useState(false);

  async function onSendLink(formData: FormData) {
    setPendingSend(true);
    const result = await sendMagicLink(formData);
    setPendingSend(false);
    if (result.ok) setSent(true);
    else toast.error(result.error);
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setPendingVerify(true);
    const result = await verifyEmailOtp({ email, token: otp });
    setPendingVerify(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form action={onSendLink} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pendingSend || !email} className="w-full">
          {pendingSend ? "Sending…" : sent ? "Resend sign-in email" : "Send sign-in email"}
        </Button>
      </form>

      {sent && (
        <div className="rounded-lg border bg-card p-4 text-sm space-y-3">
          <p>
            Check <strong>{email}</strong> for a sign-in email. It contains both a link
            and a 6-digit code.
          </p>
          <p className="text-xs text-muted-foreground">
            In local dev, open{" "}
            <a className="underline" href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
              Mailpit
            </a>{" "}
            to find it.
          </p>

          <form onSubmit={onVerifyCode} className="space-y-2 pt-2 border-t">
            <Label htmlFor="otp">Or paste the 6-digit code</Label>
            <div className="flex gap-2">
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                className="font-mono tracking-widest"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
              <Button type="submit" disabled={pendingVerify || otp.length !== 6}>
                Sign in
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
