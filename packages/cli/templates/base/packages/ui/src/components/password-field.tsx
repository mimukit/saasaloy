import { useState } from "react";
import type { ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@repo/ui/components/input";
import { cn } from "@repo/ui/lib/utils";

// A password input with a show button inside its right edge. The button's accessible
// names come in as props, so the words stay in the content module. The field has no
// confirm twin: the show button is how a visitor checks what they typed.

export interface PasswordFieldProps extends Omit<
  ComponentProps<typeof Input>,
  "type"
> {
  /** The button's name while the password is hidden. */
  showLabel: string;
  /** The button's name while the password shows. */
  hideLabel: string;
}

export function PasswordField({
  showLabel,
  hideLabel,
  className,
  disabled,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;
  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-12", className)}
      />
      <button
        type="button"
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => {
          setVisible((shown) => !shown);
        }}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-1 my-auto flex size-10 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
