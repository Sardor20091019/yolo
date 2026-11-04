---
name: ponytail
description: Pulls back loose ends, organizes code structures, cleans up messy module layouts, and formats files to be perfectly sleek and orderly. Run when requested to polish or tidy code layouts.
---

# Ponytail Formatting & Aesthetics Protocol

When this skill is triggered, optimize the cosmetic and organizational layout of the code without breaking its underlying logic:

## 1. Clean Imports & Organization
- Group imports logically:
  1. Core runtime/framework (`react`, `next/*`, `@nestjs/*`)
  2. External dependencies (`lucide-react`, `kysely`, `rxjs`)
  3. Internal shared modules/types (`@/types`, `../lib`)
  4. Local feature components/styles
- In NestJS: Order methods by lifecycle (Public Route Handlers -> Business Logic -> Private Helpers).
- In React: Order hooks cleanly (`useRef`/`useState` -> custom hooks -> `useEffect`/callbacks -> JSX return).

## 2. Code Tidiness
- Remove unused variables, dead imports, and redundant utility instances.
- Strictly enforce the **no-comment rule**—the final code must be structurally clean and completely free of comment blocks.
