import type { ComponentType } from "react";
import {
  ActivityIcon,
  AwardIcon,
  BellIcon,
  BookOpenIcon,
  BoxIcon,
  CalendarIcon,
  ClockIcon,
  CloudIcon,
  CodeIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileTextIcon,
  GaugeIcon,
  GlobeIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HeadphonesIcon,
  KeyIcon,
  LayersIcon,
  LayoutGridIcon,
  ListChecksIcon,
  LockIcon,
  MapPinIcon,
  MessageCircleIcon,
  PenLineIcon,
  PlugIcon,
  ReceiptIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  TargetIcon,
  TerminalIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { landing } from "@repo/ui/content/landing";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
// That is also why the registry below can be long without costing anything: it is read at
// build time and nothing in it reaches the browser.
//
// The words come from ../content/landing.ts, and so does each feature's icon — but as a
// *name*, not a component. Astro serializes island props, so a component cannot cross the
// .astro boundary; the registry that turns `"zap"` into `ZapIcon` therefore lives here,
// beside the render. What that buys is the thing a copy rewrite actually needs: change
// what a feature is about, change its glyph, one file, no block edit.

export interface Feature {
  /** Stable key — the translation key, never the array position (see the content file). */
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

// The names `landing.features.items[].icon` may use. Add a lucide import and a line here to
// widen it — these are ordinary source files you own, and the set below is a starting
// vocabulary, not a limit. Keep the keys kebab-case, matching lucide's own icon names, so
// picking one is a lookup rather than a guess.
const FEATURE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  activity: ActivityIcon,
  award: AwardIcon,
  bell: BellIcon,
  "book-open": BookOpenIcon,
  box: BoxIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  cloud: CloudIcon,
  code: CodeIcon,
  "credit-card": CreditCardIcon,
  database: DatabaseIcon,
  "file-text": FileTextIcon,
  gauge: GaugeIcon,
  globe: GlobeIcon,
  "graduation-cap": GraduationCapIcon,
  handshake: HandshakeIcon,
  headphones: HeadphonesIcon,
  key: KeyIcon,
  layers: LayersIcon,
  "layout-grid": LayoutGridIcon,
  "list-checks": ListChecksIcon,
  lock: LockIcon,
  "map-pin": MapPinIcon,
  "message-circle": MessageCircleIcon,
  "pen-line": PenLineIcon,
  plug: PlugIcon,
  receipt: ReceiptIcon,
  "refresh-cw": RefreshCwIcon,
  rocket: RocketIcon,
  search: SearchIcon,
  server: ServerIcon,
  "shield-check": ShieldCheckIcon,
  smartphone: SmartphoneIcon,
  sparkles: SparklesIcon,
  target: TargetIcon,
  terminal: TerminalIcon,
  "trending-up": TrendingUpIcon,
  users: UsersIcon,
  wallet: WalletIcon,
  workflow: WorkflowIcon,
  zap: ZapIcon,
};

// `Object.hasOwn` first, not a bare index: `FEATURE_ICONS[name]` walks the prototype chain,
// so a name of `constructor` or `toString` resolves to an inherited function — not nullish,
// so a `?? SparklesIcon` fallback never fires and React is handed something that isn't a
// component. Icon names are author-controlled and the saasaloy-landing-copy skill writes
// them, so this is reachable. Same reasoning as interpolate() in ../lib/interpolate.ts.
function iconFor(name: string): ComponentType<{ className?: string }> {
  return (
    (Object.hasOwn(FEATURE_ICONS, name) ? FEATURE_ICONS[name] : undefined) ??
    SparklesIcon
  );
}

const defaultFeatures: Feature[] = landing.features.items.map((item) => ({
  ...item,
  icon: iconFor(item.icon),
}));

export interface FeatureGridProps {
  id?: string;
  title?: string;
  description?: string;
  features?: Feature[];
}

export function FeatureGrid({
  id = "features",
  title = landing.features.title,
  description = landing.features.description,
  features = defaultFeatures,
}: FeatureGridProps) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20"
    >
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="text-muted-foreground mt-4 text-base text-pretty">
          {description}
        </p>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.id} className="h-full">
              <CardHeader>
                <span
                  aria-hidden="true"
                  className="bg-muted text-foreground mb-3 flex size-9 items-center justify-center rounded-lg"
                >
                  <Icon className="size-4" />
                </span>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
