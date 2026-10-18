// The icon vocabulary the landing page's content may name. Content holds an icon as a
// string (`"zap"`), never as a component: a component cannot cross the .astro island
// boundary, and the copy has to be able to change a glyph in the same edit that changes
// what an item is about. The feature grid, the pain points and the audience list all
// resolve their `icon` names here, so the three share one vocabulary.
//
// Add a lucide import and a line below to widen it. These are ordinary source files you
// own, and the set is a starting vocabulary, not a limit. Keep the keys kebab-case,
// matching lucide's own icon names, so picking one is a lookup rather than a guess.

import type { ComponentType } from "react";
import {
  ActivityIcon,
  AwardIcon,
  BellIcon,
  BookOpenIcon,
  BotIcon,
  BoxIcon,
  BuildingIcon,
  CalendarIcon,
  ClockIcon,
  CloudIcon,
  CodeIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
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
  PackageIcon,
  PenLineIcon,
  PlugIcon,
  ReceiptIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShuffleIcon,
  SmartphoneIcon,
  SparklesIcon,
  TargetIcon,
  TerminalIcon,
  TrendingUpIcon,
  UndoIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";

export type IconComponent = ComponentType<{ className?: string }>;

const ICONS: Record<string, IconComponent> = {
  activity: ActivityIcon,
  award: AwardIcon,
  bell: BellIcon,
  "book-open": BookOpenIcon,
  bot: BotIcon,
  box: BoxIcon,
  building: BuildingIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  cloud: CloudIcon,
  code: CodeIcon,
  "credit-card": CreditCardIcon,
  database: DatabaseIcon,
  file: FileIcon,
  "file-text": FileTextIcon,
  folder: FolderIcon,
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
  package: PackageIcon,
  "pen-line": PenLineIcon,
  plug: PlugIcon,
  receipt: ReceiptIcon,
  "refresh-cw": RefreshCwIcon,
  rocket: RocketIcon,
  search: SearchIcon,
  server: ServerIcon,
  "shield-check": ShieldCheckIcon,
  shuffle: ShuffleIcon,
  smartphone: SmartphoneIcon,
  sparkles: SparklesIcon,
  target: TargetIcon,
  terminal: TerminalIcon,
  "trending-up": TrendingUpIcon,
  undo: UndoIcon,
  user: UserIcon,
  users: UsersIcon,
  wallet: WalletIcon,
  workflow: WorkflowIcon,
  wrench: WrenchIcon,
  zap: ZapIcon,
};

/**
 * The component for an icon name, or a sparkle for a name the registry doesn't know.
 *
 * `Object.hasOwn` first, not a bare index: `ICONS[name]` walks the prototype chain, so a
 * name of `constructor` or `toString` resolves to an inherited function — not nullish, so
 * a `??` fallback never fires and React is handed something that isn't a component. Icon
 * names are author-controlled and the saasaloy-landing-copy skill writes them, so this is
 * reachable. Same reasoning as interpolate() in ./interpolate.ts.
 */
export function iconFor(name: string): IconComponent {
  return (Object.hasOwn(ICONS, name) ? ICONS[name] : undefined) ?? SparklesIcon;
}
