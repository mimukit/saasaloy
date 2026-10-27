// The hero illustration: an isometric wireframe of a SaaS application, after the round 9
// and round 10 hero. The application window stands in front, a sign-in panel and a
// source files panel stand behind it, and dashed leaders run down to a database and an
// email service. Line art in `highlight`, panels filled with `card`, and the one
// `primary` fill on the "New project" button. Decorative: the hero copy says it all.
//
// Geometry: every panel is drawn flat in its own coordinates and sheared by <Plane>, so
// its top edge falls 0.36 per unit of width. The application panel is 360 x 250 at
// (40, 90); its bottom edge sits at y = 340 + 0.36 * (x - 40).

import { Callout, Label, Lines, Plane, Sheet } from "@web/illustrations/parts";

function Application() {
  return (
    <Plane x={40} y={90}>
      <Sheet w={360} h={250} depth={8} />
      {/* Title bar and the three columns. */}
      <circle cx="12" cy="12" r="3" />
      <circle cx="22" cy="12" r="3" />
      <circle cx="32" cy="12" r="3" />
      <path d="M0 24h360M90 24v226M280 24v226" />
      {/* Sidebar. */}
      <Label
        x={12}
        y={44}
        size={11}
        sans
        className="fill-current font-semibold"
      >
        saasaloy
      </Label>
      <rect x="10" y="54" width="72" height="16" />
      <Label x={16} y={65} size={7}>
        Workspace
      </Label>
      <path d="m70 60 3 3 3-3" />
      <rect x="10" y="78" width="72" height="16" className="fill-secondary" />
      <Label x={28} y={89} size={7}>
        Projects
      </Label>
      <rect x="16" y="82" width="7" height="7" />
      <circle cx="19.5" cy="108" r="3.5" />
      <Label x={28} y={111} size={7}>
        Settings
      </Label>
      <circle cx="19.5" cy="126" r="3.5" />
      <Label x={28} y={129} size={7}>
        Account
      </Label>
      {/* The project list. */}
      <Label
        x={104}
        y={48}
        size={12}
        sans
        className="fill-current font-semibold"
      >
        Projects
      </Label>
      <rect x="206" y="36" width="64" height="16" className="fill-primary" />
      <Label
        x={238}
        y={47}
        size={7}
        anchor="middle"
        className="fill-primary-foreground"
      >
        New project
      </Label>
      {[0, 1, 2, 3].map((row) => (
        <g key={row} transform={`translate(0 ${66 + row * 28})`}>
          <rect x="104" y="0" width="10" height="10" />
          <Lines x={122} y={3} widths={[72, 48]} />
          <path d="M248 5h1M252 5h1M256 5h1" strokeWidth="1.5" />
          <path className="stroke-border" d="M100 20h174" />
        </g>
      ))}
      {/* Settings column. */}
      <Label
        x={288}
        y={48}
        size={10}
        sans
        className="fill-current font-semibold"
      >
        Settings
      </Label>
      {[0, 1, 2].map((field) => (
        <g key={field} transform={`translate(0 ${64 + field * 44})`}>
          <Lines x={288} y={0} widths={[40]} />
          <rect x="288" y="8" width="64" height="18" />
        </g>
      ))}
      <rect x="288" y="206" width="64" height="18" />
      <Label x={320} y={218} size={7} anchor="middle">
        Save changes
      </Label>
    </Plane>
  );
}

function SignIn() {
  return (
    <Plane x={300} y={22}>
      <Sheet w={130} h={190} />
      <Label x={14} y={30} size={9} sans className="fill-current font-semibold">
        Welcome back
      </Label>
      <rect x="14" y="44" width="102" height="18" />
      <rect x="20" y="50" width="7" height="6" />
      <rect x="14" y="70" width="102" height="18" />
      <path d="M20 79h7M23.5 76v6" />
      <rect x="14" y="98" width="102" height="18" />
      <Label x={65} y={110} size={7} anchor="middle">
        Sign in
      </Label>
    </Plane>
  );
}

function SourceFiles() {
  return (
    <Plane x={470} y={40}>
      <Sheet w={120} h={260} />
      <Sheet w={120} h={260} depth={3} />
      <path d="M40 0v260" />
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <path
          key={row}
          d={`M10 ${22 + row * 18}h5l2 2h7v8h-14z`}
          className="stroke-current"
        />
      ))}
      <Lines
        x={50}
        y={24}
        gap={9}
        widths={[
          44, 30, 52, 24, 40, 56, 20, 36, 48, 28, 44, 52, 18, 40, 30, 50, 24,
          44, 36, 26,
        ]}
      />
    </Plane>
  );
}

export function AppWireframe({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 520"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Construction lines behind everything. */}
      <path
        className="stroke-border"
        strokeDasharray="3 4"
        d="M20 90h420M40 60v420M400 200v290M300 20v80M470 30v330M590 70v300M20 380l600 0"
      />

      <SignIn />
      <SourceFiles />
      <Application />

      {/* The database, under the application. */}
      <g>
        <path d="M156 446v40a34 11 0 0 0 68 0v-40" className="fill-card" />
        <ellipse cx="190" cy="446" rx="34" ry="11" className="fill-card" />
        <path d="M156 466a34 11 0 0 0 68 0" />
      </g>
      <path
        strokeDasharray="3 3"
        d="M190 432v-46M184 426l6 6 6-6M250 488h290M534 482l6 6-6 6"
      />

      {/* The email service, an envelope in an isometric box. */}
      <g>
        <polygon
          points="540,444 580,424 612,440 572,460"
          className="fill-card"
        />
        <polygon
          points="540,444 572,460 572,488 540,472"
          className="fill-card"
        />
        <polygon
          points="572,460 612,440 612,468 572,488"
          className="fill-card"
        />
        <path d="M546 452l10 12 10-1M578 466l14 4 14-18" />
      </g>
      <path strokeDasharray="3 3" d="M592 400v24M586 418l6 6 6-6" />

      <Callout x={96} y={40} label="Application" to={[120, 112]} />
      <Callout x={364} y={12} label="Sign-in" to={[352, 50]} />
      <Callout
        x={636}
        y={22}
        label="Source files"
        anchor="end"
        to={[540, 72]}
      />
      <Callout x={88} y={504} label="Database" to={[156, 470]} />
      <Callout x={636} y={508} label="Email" anchor="end" to={[600, 478]} />
    </svg>
  );
}
