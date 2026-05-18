"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { sendMagicLink } from "@/server-actions/auth";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const result = await sendMagicLink(formData);
    setPending(false);
    if (result.ok) {
      setSent(true);
    } else {
      toast.error(result.error);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p>
          Check <strong>{email}</strong> for a sign-in link. The link works once and
          expires in 10 minutes.
        </p>
        <button
          type="button"
          className="mt-3 text-muted-foreground underline text-xs"
          onClick={() => setSent(false)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-3">
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
      <Button type="submit" disabled={pending || !email} className="w-full">
        {pending ? "Sending…" : "Send sign-in link"}
      </Button>
    </form>
  );
}
