# `@mapvest/design` — Atlas Signal

Tokenized theme for Mapvest web + iOS. Change `tokens.ts` (and mirror `tokens.css`) to restyle the product without hunting through screens.

## Theme

**Atlas Signal** — graphite canvas, jade actions (Robinhood-familiar), Maps-like place IA, ChatGPT-like research clarity, X-like density. No purple, no glow.

## Usage

```ts
import { tokens } from "@mapvest/design";
// tokens.color.accent → "#3ECF8E"
```

```css
@import "@mapvest/design/tokens.css";
```

iOS copies values into `apps/ios/src/theme/tokens.ts` (Metro cannot resolve workspace packages reliably).
