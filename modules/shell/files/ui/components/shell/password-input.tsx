import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@repo/ui/components/shell/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import type { InputProps } from "@repo/ui/components/shell/input";

// The shell's password input: an input group with a show and hide button at its inline
// end. It is the shell twin of the base `PasswordField`, which the lint rule bars from a
// signed-in app. The button's names come in as props, so the words stay in the content
// module.

export interface PasswordInputProps extends Omit<
  InputProps,
  "type" | "className"
> {
  /** Classes for the group around the input and the button. */
  className?: string;
  /** The button's name while the password is hidden. */
  showLabel: string;
  /** The button's name while the password shows. */
  hideLabel: string;
}

export function PasswordInput({
  showLabel,
  hideLabel,
  className,
  disabled,
  ...props
}: PasswordInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;
  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <InputGroupAddon align="inline-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => {
            setVisible((shown) => !shown);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <Icon aria-hidden />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
