import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";
import { landing } from "@repo/ui/content/landing";

// Accordion is a compound primitive: trigger and panel talk to a context the root
// provides. Astro gives every `client:*` component its own React root, so splitting the
// pieces across an .astro file would break that context at runtime — the whole block is
// one island, hydrated with `client:visible` from index.astro.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here.

export interface FaqItem {
  /** Stable key, never the array position (see the content file). */
  id: string;
  question: string;
  answer: string;
}

export interface FaqProps {
  id?: string;
  title?: string;
  description?: string;
  items?: FaqItem[];
}

export function Faq({
  id = "faq",
  title = landing.faq.title,
  description = landing.faq.description,
  items = landing.faq.items,
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
          <AccordionItem key={item.id}>
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
