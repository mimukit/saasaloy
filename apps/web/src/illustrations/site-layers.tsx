// The site source illustration: this site pulled apart into its layers, after the round
// 10 mockup. The landing page panel stands in front of the Astro, UI and source files
// panels, and dashed leaders run down to the source repository, which also takes the
// Saasaloy module blocks on the left. Line art in `highlight`, panels in `card`, and
// the one `primary` fill on the repository's front face. Decorative.
//
// Motion: the drawing comes apart as it scrolls in. The three back panels start stacked
// behind the landing panel and slide out to their places, the module blocks stack from
// the bottom up, the repository rises, and the leaders to it flow.

import {
  Assemble,
  Callout,
  IsoBox,
  Lines,
  Plane,
  Sheet,
} from "@web/illustrations/parts";

export function SiteLayers({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 470"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <Assemble at={0} span={30}>
        <path
          className="stroke-border"
          strokeDasharray="3 4"
          d="M20 70v260M210 140v200M462 150v200M20 340h570"
        />
      </Assemble>

      {/* Source files, the back panel. Each back panel starts at the landing panel's
          place, (20, 78), behind it. */}
      <Assemble at={20} span={55} x={-456} y={-22}>
        <Plane x={476} y={100}>
          <Sheet w={110} h={140} />
          <path d="M12 16l-5 5 5 5M24 16l5 5-5 5" />
          {[0, 1, 2, 3, 4].map((row) => (
            <rect key={row} x="10" y={40 + row * 18} width="9" height="9" />
          ))}
          <Lines x={28} y={45} gap={18} widths={[60, 44, 66, 38, 52]} />
        </Plane>
      </Assemble>

      {/* UI: a component on a page. */}
      <Assemble at={15} span={50} x={-302} y={-4}>
        <Plane x={322} y={74}>
          <Sheet w={140} h={150} />
          <path className="stroke-border" d="M0 18h140M70 18v132" />
          <g transform="translate(36 60)">
            <path d="M0-14 18-6v18L0 20-18 12v-18zM-18-6 0 2l18-8M0 2v18" />
          </g>
          <Lines x={80} y={36} gap={10} widths={[48, 36, 50, 30, 44, 40, 26]} />
          <Lines x={10} y={104} gap={10} widths={[50, 40, 52]} />
        </Plane>
      </Assemble>

      {/* Astro: the page shell. */}
      <Assemble at={10} span={45} x={-156} y={26}>
        <Plane x={176} y={52}>
          <Sheet w={130} h={150} depth={8} />
          <circle cx="10" cy="10" r="2.5" />
          <circle cx="18" cy="10" r="2.5" />
          <path d="M0 20h130" />
          <Lines
            x={10}
            y={34}
            gap={9}
            widths={[90, 70, 100, 60, 84, 76, 92, 50, 70, 88, 64]}
          />
        </Plane>
      </Assemble>

      {/* Landing: the public page, in front. */}
      <Assemble at={0} span={25}>
        <Plane x={20} y={78}>
          <Sheet w={190} h={150} depth={10} />
          <Sheet w={190} h={150} depth={4} />
          <circle cx="14" cy="14" r="5" />
          <path d="M110 14h12M130 14h12M150 14h12M170 14h8" />
          <rect x="14" y="30" width="162" height="56" />
          <path d="M30 80l30-26 22 18 16-12 30 20" />
          <circle cx="118" cy="46" r="6" />
          <path d="M14 98h120" strokeWidth="2" />
          <path className="stroke-border" d="M14 106h90" />
          <rect x="14" y="116" width="46" height="24" />
          <rect x="72" y="116" width="46" height="24" />
          <rect x="130" y="116" width="46" height="24" />
        </Plane>
      </Assemble>

      {/* Saasaloy module blocks, stacked from the bottom up. */}
      <Assemble at={40} span={20} y={-20}>
        <IsoBox x={100} y={426} w={34} h={24} />
      </Assemble>
      <Assemble at={47} span={20} y={-20}>
        <IsoBox x={100} y={394} w={34} h={24} />
      </Assemble>
      <Assemble at={54} span={20} y={-20}>
        <IsoBox x={100} y={362} w={34} h={24} />
        <path d="M90 380l-5 4 5 4M104 376l5 4-5 4M99 374l-4 12" />
      </Assemble>

      {/* The source repository. */}
      <Assemble at={40} span={30} y={20}>
        <IsoBox x={420} y={372} w={90} h={46} front="fill-primary" />
        <path className="stroke-border" d="M352 338l90 45M376 326l90 45" />
        <g
          transform="matrix(0.894 0.447 0 1 346 386)"
          className="text-primary-foreground"
        >
          <path d="M18 2l12 12-12 12L6 14z" />
          <circle cx="18" cy="10" r="2" />
          <circle cx="18" cy="20" r="2" />
          <circle cx="24" cy="15" r="2" />
          <path d="M18 12v6M19.5 11.5l3 2.5" />
        </g>
      </Assemble>
      <Assemble at={60}>
        <g strokeDasharray="3 3">
          <path className="flow" d="M138 400h180" />
          <path className="flow" d="M150 300l60 30 70 30" />
          <path className="flow" d="M380 286v40" />
          <path d="M312 394l6 6-6 6M274 354l6 6-8 2M374 320l6 6 6-6" />
        </g>
      </Assemble>

      <Callout
        x={30}
        y={36}
        label="Landing (public site)"
        to={[70, 92]}
        at={55}
      />
      <Callout x={290} y={22} label="Astro" to={[240, 76]} at={58} />
      <Callout x={470} y={40} label="UI" to={[400, 104]} at={61} />
      <Callout
        x={596}
        y={62}
        label="Source files"
        anchor="end"
        to={[540, 128]}
        at={64}
      />
      <Callout x={4} y={330} label="Saasaloy modules" to={[66, 352]} at={67} />
      <Callout
        x={230}
        y={462}
        label="Source repository"
        to={[340, 410]}
        at={70}
      />
    </svg>
  );
}
