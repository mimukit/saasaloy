import { useFramework } from "@repo/ui/adapters";
import { Button } from "@repo/ui/components/ui/button";
import { Card } from "@repo/ui/components/ui/card";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/select";
import { Textarea } from "@repo/ui/components/ui/textarea";

export function Contact() {
  const { Link } = useFramework();

  return (
    <section className="bg-background @container py-24">
      <div className="mx-auto max-w-2xl px-6">
        <div className="text-center">
          <h1 className="font-serif text-4xl font-medium text-balance sm:text-5xl">
            Contact Sales
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-md text-balance">
            Ready to get started? Our team will help you find the right plan for
            your business.
          </p>
        </div>

        <Card variant="outline" className="mt-12 p-8">
          <form action="" className="space-y-5">
            <div className="grid gap-4 @md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="text-sm">
                  First name
                </Label>
                <Input type="text" id="firstName" name="firstName" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-sm">
                  Last name
                </Label>
                <Input type="text" id="lastName" name="lastName" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm">
                Work email
              </Label>
              <Input type="email" id="email" name="email" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company" className="text-sm">
                Company
              </Label>
              <Input type="text" id="company" name="company" />
            </div>

            <div className="grid gap-4 @md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="size" className="text-sm">
                  Company size
                </Label>
                <Select>
                  <SelectTrigger className="ring-input focus-visible:ring-ring/15 bg-card h-8 shadow-none dark:bg-transparent">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="ring-border rounded-xl border-transparent ring-1">
                    <SelectItem value="1-10">1-10 employees</SelectItem>
                    <SelectItem value="11-50">11-50 employees</SelectItem>
                    <SelectItem value="51-200">51-200 employees</SelectItem>
                    <SelectItem value="201-500">201-500 employees</SelectItem>
                    <SelectItem value="500+">500+ employees</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="interest" className="text-sm">
                  Interest
                </Label>
                <Select>
                  <SelectTrigger className="ring-input focus-visible:ring-ring/15 bg-card h-8 shadow-none dark:bg-transparent">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="ring-border rounded-xl border-transparent ring-1">
                    <SelectItem value="pricing">Pricing</SelectItem>
                    <SelectItem value="demo">Product demo</SelectItem>
                    <SelectItem value="partnership">Partnership</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message" className="text-sm">
                Message
              </Label>
              <Textarea
                id="message"
                name="message"
                rows={5}
                placeholder="Tell us about your needs..."
                className="min-h-28"
              />
            </div>

            <Button className="w-full">Submit</Button>
          </form>
        </Card>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          By submitting, you agree to our{" "}
          <Link
            href="/legal/privacy-policy"
            className="text-foreground underline"
          >
            Privacy Policy
          </Link>
        </p>
      </div>
    </section>
  );
}
