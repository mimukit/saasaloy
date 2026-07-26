import { useState, type FormEvent } from "react";

// Falls back to the api Worker's local dev port (`vite dev`'s default) when
// PUBLIC_API_URL isn't set — see the saasaloy-waitlist skill for the production value.
const API_BASE = import.meta.env.PUBLIC_API_URL ?? "http://localhost:5173";

type Status = "idle" | "submitting" | "success" | "error";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch(`${API_BASE}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return <p role="status">You're on the list — we'll be in touch.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="waitlist-email">Email</label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        disabled={status === "submitting"}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Joining…" : "Join the waitlist"}
      </button>
      {status === "error" && <p role="alert">Something went wrong — try again.</p>}
    </form>
  );
}
