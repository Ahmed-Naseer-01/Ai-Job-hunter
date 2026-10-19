"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="error" role="alert">
      <h2>Something went wrong</h2>
      <p>The page could not be loaded. {error.digest ? <>Reference: <code>{error.digest}</code></> : null}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
