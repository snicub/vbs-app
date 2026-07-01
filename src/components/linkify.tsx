import { Fragment } from "react";

// Split on http(s) URLs, keeping them as their own parts (capturing group).
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;

/**
 * Render free text with any http(s) URLs turned into clickable links — used for
 * the family "notes" field, where staff sometimes paste a maps link. Everything
 * else prints as plain text. Server-safe (no client hooks).
 */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline break-all"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
