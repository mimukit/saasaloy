# @repo/auth

Authentication package for Saasaloy using [better-auth](https://www.better-auth.com/).

## Features

- **Drizzle ORM Adapter**: Connected to `@repo/database`.
- **Email/Password**: Traditional login/signup.
- **Social Providers**: Support for Google and GitHub.
- **React/Next.js Client**: Frontend hooks and utilities.

## Setup

### 1. Environment Variables

Add the following to your `.env` or `@repo/config`:

```bash
BETTER_AUTH_SECRET=your_secret
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### 2. Database Schema

The auth schema tables are already included in `@repo/database`. You just need to run migrations to create them:

```bash
pnpm --filter @repo/database db:push
# OR
pnpm --filter @repo/database db:generate && pnpm --filter @repo/database db:migrate
```

## Usage

### Server

```typescript
import { auth } from "@repo/auth/server";

// Use auth in your API routes or middleware
```

### Client (React)

```typescript
import { authClient } from "@repo/auth/client";

const { data: session } = authClient.useSession();
```
