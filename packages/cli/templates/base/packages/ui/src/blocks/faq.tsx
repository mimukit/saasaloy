import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";

// Accordion is a compound primitive: trigger and panel talk to a context the root
// provides. Astro gives every `client:*` component its own React root, so splitting the
// pieces across an .astro file would break that context at runtime — the whole block is
// one island, hydrated with `client:visible` from index.astro.

export interface FaqItem {
  question: string;
  answer: string;
}

const defaultItems: FaqItem[] = [
  {
    answer:
      "A working monorepo: a static marketing site, a shared design system, and a command that adds the rest — API, database, auth, billing — one capability at a time.",
    question: "What do I actually get?",
  },
  {
    answer:
      "No. Everything is copied into your repository as source you own and edit. There is no framework release to chase and nothing that overwrites your changes behind your back.",
    question: "Is this a boilerplate I have to keep in sync?",
  },
  {
    answer:
      "Yes. The theme is a single stylesheet of design tokens and the components are plain files in your repo, so restyling is editing, not forking.",
    question: "Can I use my own design system?",
  },
  {
    answer:
      "Cloudflare, by default — static assets on Workers, with the same account covering the database, queues and storage a feature module needs later.",
    question: "Where does it deploy?",
  },
  {
    answer:
      "Then you keep the code. Nothing here is a runtime dependency on us: the generated project is an ordinary pnpm workspace that builds without any of our tooling installed.",
    question: "What if I outgrow it?",
  },
];

export interface FaqProps {
  id?: string;
  title?: string;
  description?: string;
  items?: FaqItem[];
}

export function Faq({
  id = "faq",
  title = "Questions, answered",
  description = "The things people ask before they commit a weekend to a new stack.",
  items = defaultItems,
}: FaqProps) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-3xl scroll-mt-20 px-6 py-20"
    >
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="text-muted-foreground mt-4 text-base text-pretty">
          {description}
        </p>
      </div>

      <Accordion className="mt-12">
        {items.map((item) => (
          <AccordionItem key={item.question}>
            <AccordionTrigger className="text-base">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
