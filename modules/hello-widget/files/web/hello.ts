export function greeting(): string {
  return process.env.HELLO_GREETING ?? "Hello";
}
