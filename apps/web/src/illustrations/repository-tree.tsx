// The FAQ illustration: a project's repository tree beside a stack of module source
// files, after the round 10 mockup. The tree is the shape a Saasaloy project takes once
// `api`, `database` and `auth` are in: the base's `apps/web` and `packages/ui`, then the
// workspaces those modules add. Line art in `highlight`, and the one `primary` fill on
// the front source file. Decorative: the answers beside it carry the facts.

import { Callout, Label, points } from "@web/illustrations/parts";

const TREE: { name: string; depth: number; folder: boolean }[] = [
  { name: "my-app/", depth: 0, folder: true },
  { name: "apps/", depth: 1, folder: true },
  { name: "web/", depth: 2, folder: true },
  { name: "api/", depth: 2, folder: true },
  { name: "packages/", depth: 1, folder: true },
  { name: "ui/", depth: 2, folder: true },
  { name: "db/", depth: 2, folder: true },
  { name: "auth/", depth: 2, folder: true },
  { name: "AGENTS.md", depth: 1, folder: false },
  { name: "package.json", depth: 1, folder: false },
];

const ROW = 24;

/** A source file card standing in the stack, `n` steps back from the front. */
function SourceCard({ n, front = false }: { n: number; front?: boolean }) {
  const x = 352 + n * 14;
  const y = 150 - n * 10;
  return (
    <g>
      <polygon
        className={front ? "fill-primary" : "fill-card"}
        points={points(x, y, x + 70, y + 35, x + 70, y + 125, x, y + 90)}
      />
      <polygon
        className="fill-card"
        points={points(x, y, x + 6, y - 4, x + 76, y + 31, x + 70, y + 35)}
      />
      <polygon
        className="fill-card"
        points={points(
          x + 70,
          y + 35,
          x + 76,
          y + 31,
          x + 76,
          y + 121,
          x + 70,
          y + 125
        )}
      />
      {front && (
        <g
          transform={`matrix(0.894 0.447 0 1 ${x} ${y})`}
          className="text-primary-foreground"
        >
          <path
            d="M30 42l-8 8 8 8M48 42l8 8-8 8M42 38l-6 24"
            strokeWidth="1.5"
          />
        </g>
      )}
    </g>
  );
}

export function RepositoryTree({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 320"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <Label
        x={14}
        y={20}
        size={10}
        sans
        className="fill-current font-semibold"
      >
        Your repository
      </Label>
      <rect x="10" y="30" width="250" height="280" className="fill-card" />
      {TREE.map((entry, index) => {
        const x = 26 + entry.depth * 24;
        const y = 56 + index * ROW;
        return (
          <g key={entry.name}>
            {entry.depth > 0 && (
              <path
                className="stroke-border"
                d={`M${x - 14} ${y - 18}v16h10`}
              />
            )}
            {entry.folder ? (
              <path d={`M${x} ${y - 9}h6l2 2h8v9h-16z`} />
            ) : (
              <path d={`M${x + 2} ${y - 10}h8l4 4v10h-12z`} />
            )}
            <Label x={x + 24} y={y}>
              {entry.name}
            </Label>
          </g>
        );
      })}

      {[4, 3, 2, 1].map((n) => (
        <SourceCard key={n} n={n} />
      ))}
      <SourceCard n={0} front />
      <Label x={330} y={30} size={10}>
        Module source files
      </Label>
      <Callout x={330} y={44} label="in your repository." to={[356, 132]} />
      <path strokeDasharray="3 3" d="M262 224h78M334 218l6 6-6 6" />
    </svg>
  );
}
