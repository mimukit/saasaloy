// The providers illustration: the `email` capability as one module with one interface,
// and three interchangeable provider modules plugged under it, after the round 10
// mockup. The capability's source files sit to its left. Line art in `highlight`, module
// bodies in `card`, and the one `primary` fill on the capability's connector, the
// interface every provider plugs into. Decorative: the copy beside it carries the facts.

import type { ReactNode } from "react";

import { Label, Lines, Sheet } from "@web/illustrations/parts";

const PROVIDERS: { name: string; note: string; x: number; icon: ReactNode }[] =
  [
    {
      name: "email-cloudflare",
      note: "Email via Cloudflare.",
      x: 110,
      icon: (
        <path d="M-11 6h22a6 6 0 0 0 0-12 9 9 0 0 0-17-2A6 6 0 0 0-11 6z" />
      ),
    },
    {
      name: "email-plunk",
      note: "Email via Plunk.",
      x: 322,
      icon: <path d="M-12-2 12-10 4 10 0 2zM0 2l12-12" />,
    },
    {
      name: "email-console",
      note: "Send emails locally.",
      x: 534,
      icon: <path d="M-12-9h24v18h-24zM-7-3l4 3-4 3M0 4h6" />,
    },
  ];

/** A module body: a frame with rails on both sides and a screw in each corner. */
function ModuleBody({
  x,
  y,
  w,
  h,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return (
    <g>
      <rect
        x={x - 6}
        y={y + 12}
        width={6}
        height={h - 24}
        className="fill-card"
      />
      <rect
        x={x + w}
        y={y + 12}
        width={6}
        height={h - 24}
        className="fill-card"
      />
      <rect x={x} y={y} width={w} height={h} className="fill-card" />
      <rect
        x={x + 6}
        y={y + 6}
        width={w - 12}
        height={h - 12}
        className="stroke-border"
      />
      {[
        [x + 12, y + 12],
        [x + w - 12, y + 12],
        [x + 12, y + h - 12],
        [x + w - 12, y + h - 12],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" />
      ))}
    </g>
  );
}

export function ProviderModules({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 350"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* The capability's source files. */}
      <g transform="translate(20 46)">
        <Sheet w={150} h={112} depth={6} />
        <Label x={10} y={16}>
          src
        </Label>
        <path className="stroke-border" d="M0 24h150" />
        <path d="M14 34h7l2 2h9v9h-18z" />
        <Label x={38} y={44}>
          email
        </Label>
        <path
          className="stroke-border"
          d="M22 48v50M22 62h12M22 80h12M22 98h12"
        />
        {["index.ts", "provider.ts", "types.ts"].map((file, index) => (
          <g key={file}>
            <path d={`M38 ${56 + index * 18}h7l3 3v9h-10z`} />
            <Label x={54} y={66 + index * 18}>
              {file}
            </Label>
          </g>
        ))}
      </g>
      <path strokeDasharray="3 3" d="M180 102h44M218 96l6 6-6 6" />

      {/* The capability. */}
      <Label x={232} y={26} size={10} className="fill-current font-semibold">
        EMAIL CAPABILITY
      </Label>
      <Lines x={232} y={36} widths={[150]} />
      <ModuleBody x={232} y={50} w={180} h={100} />
      <path d="M306 82h36v24h-36zM306 82l18 13 18-13" />
      <Label x={322} y={128} anchor="middle">
        email
      </Label>
      <rect x="296" y="150" width="52" height="10" className="fill-primary" />

      {/* The connections, then the three providers. */}
      <path
        strokeDasharray="3 3"
        d="M322 160v22M110 182h424M110 182v20M534 182v20M322 182v20"
      />
      {PROVIDERS.map((provider) => (
        <g key={provider.name}>
          <rect
            x={provider.x - 30}
            y={202}
            width={60}
            height={10}
            className="fill-card"
          />
          <path
            className="stroke-border"
            d={`M${provider.x - 24} 202v10M${provider.x - 12} 202v10M${provider.x} 202v10M${provider.x + 12} 202v10M${provider.x + 24} 202v10`}
          />
          <ModuleBody x={provider.x - 80} y={212} w={160} h={78} />
          <g transform={`translate(${provider.x} 240)`}>{provider.icon}</g>
          <Label x={provider.x} y={274} anchor="middle">
            {provider.name}
          </Label>
          <rect
            x={provider.x - 76}
            y={302}
            width={152}
            height={40}
            className="fill-card"
          />
          <path className="stroke-border" d={`M${provider.x - 76} 320h152`} />
          <Label
            x={provider.x}
            y={315}
            anchor="middle"
            className="fill-current font-semibold"
          >
            {provider.name}
          </Label>
          <Label x={provider.x} y={334} size={8} anchor="middle">
            {provider.note}
          </Label>
        </g>
      ))}
    </svg>
  );
}
