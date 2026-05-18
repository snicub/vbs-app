"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { lookupByWristband, searchStudentsByName } from "@/server-actions/events";
import { WRISTBAND_LENGTH } from "@/lib/wristband/alphabet";

export function TableSearchClient() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [matches, setMatches] = useState<
    { id: string; name: string; wristbandCode: string }[]
  >([]);
  const [pending, startTransition] = useTransition();

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await lookupByWristband({ code });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/table/${encodeURIComponent(result.student.wristbandCode)}`);
    });
  }

  async function onNameSearch(query: string) {
    setNameQuery(query);
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const result = await searchStudentsByName(query);
    if (result.ok) setMatches(result.matches);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onLookup} className="space-y-3">
        <label className="block text-sm font-medium">Wristband code</label>
        <div className="flex gap-2">
          <Input
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}   // 5 chars + 1 typo grace
            placeholder="e.g. AB23X"
            className="text-xl font-mono tracking-widest uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={pending || code.length < WRISTBAND_LENGTH}>
            Look up
          </Button>
        </div>
      </form>

      <div>
        <div className="text-sm font-medium mb-2">…or search by name</div>
        <Input
          placeholder="At least 2 letters"
          value={nameQuery}
          onChange={(e) => onNameSearch(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="mt-3 rounded border divide-y bg-card">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  className="block w-full text-left px-3 py-2 hover:bg-muted text-sm"
                  onClick={() => router.push(`/table/${m.wristbandCode}`)}
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {m.wristbandCode}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
