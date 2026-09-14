import { NextResponse } from "next/server";

// Every route handler here calls out to Wikipedia and/or Supabase, either
// of which can throw (rate limits, network blips). Without this, an
// uncaught exception becomes an empty-body 500 — the client's `res.json()`
// then throws its own unrelated-looking SyntaxError instead of surfacing
// a real error message.
export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 502 });
    }
  };
}
