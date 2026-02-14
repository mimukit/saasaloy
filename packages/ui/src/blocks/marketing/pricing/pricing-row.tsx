import { useFramework } from "@repo/ui/adapters";
import { Button } from "@repo/ui/components/ui/button";
import { Card } from "@repo/ui/components/ui/card";
import { cn } from "@repo/ui/lib/utils";
import { ArrowRight } from "lucide-react";

const tiers = [
  {
    name: "Hobby",
    description: "For personal projects",
    price: "$0",
    period: "/month",
    limit: "1,000 requests/month",
  },
  {
    name: "Pro",
    description: "For professional use",
    price: "$20",
    period: "/month",
    limit: "50,000 requests/month",
    highlighted: true,
  },
  {
    name: "Scale",
    description: "For high-volume apps",
    price: "$100",
    period: "/month",
    limit: "500,000 requests/month",
  },
  {
    name: "Enterprise",
    description: "For large organizations",
    price: "Custom",
    period: "",
    limit: "Unlimited requests",
  },
];

export function Pricing() {
  const { Link } = useFramework();
  return (
    <section className="bg-background @container py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <h2 className="font-serif text-4xl font-medium text-balance">
            Usage-Based Pricing
          </h2>
          <p className="text-muted-foreground mx-auto mt-4 max-w-md text-balance">
            Pay only for what you use. All plans include the same features.
          </p>
        </div>
        <div className="mt-12 space-y-3">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              variant="outline"
              className={cn(
                "flex flex-col gap-4 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between",
                tier.highlighted && "ring-primary"
              )}
            >
              <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center @2xl:gap-6">
                <div className="shrink-0 @2xl:w-44">
                  <h3 className="text-foreground font-medium">{tier.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {tier.description}
                  </p>
                </div>
                <div className="@2xl:border-l @2xl:pl-6">
                  <p className="text-muted-foreground text-sm">{tier.limit}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center">
                <div className="@2xl:text-right">
                  <span className="font-serif text-2xl font-medium">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-muted-foreground text-sm">
                      {tier.period}
                    </span>
                  )}
                </div>
                <Button
                  asChild
                  variant={tier.highlighted ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                >
                  <Link href="#link">
                    {tier.price === "Custom" ? "Contact Us" : "Get Started"}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
        <div className="bg-muted mt-8 rounded-xl p-6 text-center">
          <p className="text-foreground font-medium">Need more requests?</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Additional requests are billed at $0.001 per request after your plan
            limit.
          </p>
        </div>
      </div>
    </section>
  );
}
