# @repo/ui

A framework-agnostic UI component library for the SaasAloy monorepo. Built with React, Tailwind CSS, and Lucide.

## Project Structure

```text
packages/ui/
├── src/
│   ├── adapters/     # Dependency Injection for framework-specific components
│   ├── blocks/       # High-level complex UI sections (e.g., HeroSections)
│   │   └── marketing/
│   │   |   └── hero/
│   ├── components/
│   │   ├── shared/   # Common components shared across blocks (e.g., Logo)
│   │   └── ui/       # Core primitive components (e.g., Button)
│   ├── lib/          # Utilities and helper functions
│   └── styles/       # Global CSS and Tailwind configuration
├── package.json      # Package configuration and exports
└── tsconfig.json     # TypeScript configuration
```

## Usage

### UI Components

Import primitive UI components:

```tsx
import { Button } from "@repo/ui/components/ui/button";
```

### Marketing Blocks

Import high-level marketing blocks:

```tsx
import HeroSection from "@repo/ui/blocks/marketing/hero/hero-section";
```

### Styles

Import the global styles in your application's root:

```tsx
import "@repo/ui/globals.css";
```

## Framework Adapters (Dependency Injection)

To ensure components remain "Sovereign" and framework-agnostic, we use a **Dependency Injection (DI) pattern** via React Context. This allows shared blocks to request a `Link` or `Image` component without knowing if they are rendered by Next.js, Astro, or a standard SPA.

### How it Works

The `@repo/ui` package provides a `FrameworkProvider` and a `useFramework` hook. Components use these to access framework-specific implementations of core primitives.

### Usage in Apps

Wrap your application (or specific sections) in the `FrameworkProvider` and inject the appropriate components.

#### Next.js Implementation

```tsx
// apps/web-next/providers/framework-provider.tsx
import { FrameworkProvider } from "@repo/ui/adapters";
import Image from "next/image";
import Link from "next/link";

export function NextFrameworkProvider({ children }) {
  return (
    <FrameworkProvider adapters={{ Link, Image }}>{children}</FrameworkProvider>
  );
}
```

#### Astro Implementation

```tsx
// apps/web-astro/components/AstroFrameworkProvider.tsx
import { FrameworkProvider } from "@repo/ui/adapters";

export function AstroFrameworkProvider({ children }) {
  return (
    <FrameworkProvider
      adapters={{
        Link: ({ href, children, ...props }) => (
          <a href={href} {...props}>
            {children}
          </a>
        ),
        Image: (props) => <img {...props} />,
      }}
    >
      {children}
    </FrameworkProvider>
  );
}
```

### Usage in Components

When building new components in `@repo/ui`, always use the `useFramework` hook for links and images:

```tsx
import { useFramework } from "@repo/ui/adapters";

export const MyComponent = () => {
  const { Link, Image } = useFramework();

  return (
    <div>
      <Image src="/logo.png" alt="Logo" />
      <Link href="/dashboard">Go to Dashboard</Link>
    </div>
  );
};
```

> [!TIP]
> If no `FrameworkProvider` is present, the hook fallbacks to standard HTML `<a>` and `<img>` tags automatically.
