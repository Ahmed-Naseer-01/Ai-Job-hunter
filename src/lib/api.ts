import { NextResponse } from "next/server";
import { ValidationError } from "./services/actions";

type Handler<A extends unknown[]> = (...args: A) => Promise<Response | object>;

/** Wraps a route handler: JSON in/out, validation errors -> 4xx, everything else -> a generic 500 (details are logged server-side only). */
export function route<A extends unknown[]>(fn: Handler<A>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e: any) {
      if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e?.status === 404) return NextResponse.json({ error: e.message || "Not found" }, { status: 404 });
      if (e instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      console.error("[api]", e?.stack ?? e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 1_000_000) throw new ValidationError("Request body too large");
  return text ? JSON.parse(text) : {};
}

export const intParam = (v: string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
