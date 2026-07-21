// Minimal console reporter. Kept dependency-free; richer formatting can graft on
// later without changing call sites.

export const logger = {
  info(message: string): void {
    console.log(message);
  },
  step(message: string): void {
    console.log(`  ${message}`);
  },
  success(message: string): void {
    console.log(`✓ ${message}`);
  },
  warn(message: string): void {
    console.warn(`! ${message}`);
  },
  error(message: string): void {
    console.error(`✗ ${message}`);
  },
};
