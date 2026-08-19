# Doppler (personal workplace)

Secrets for Jawaun’s Railway apps live in the **jawaun personal** Doppler workplace. They do **not** live in GIC `cofounder` / Superoptimizers.

This Mapvest repo is scoped to that workplace (`doppler login --scope .`). Other checkouts keep the GIC token via `--scope /Users/jawaun/superoptimizers`.

## Layout

One Doppler **project per Railway project**, plus `shared`.

| Doppler project | Railway `production` source | Configs |
|---|---|---|
| `shared` | majority provider tokens + GIC extras | `dev` / `prd` |
| `mapvest` | service `api` | `dev` / `prd`; `prd_landing` |
| `derivation-research-console` | service `derivation-research-console` | `dev` / `prd`; `prd_railway_campaign_worker` |
| `inquiry-black-box` | `inquiry-black-box-api` | `dev` / `prd` |
| `inquiry-black-box-site` | site | `dev` / `prd` |
| `objetdart` | `objetdart` | `dev` / `prd` |
| `underlying-terminal` | `underlying-terminal` | `dev` / `prd`; `prd_daily_alert_digest` |
| `compiler-tomography` | app | `dev` / `prd` |
| `reafference-chat` | `web` | `dev` / `prd` |
| `conjecture-lab` | `web` | `dev` / `prd` |
| `philo-video-brainlab` | app | `dev` / `prd` |
| other Railway apps | empty on Railway today | `dev` / `prd` placeholders |

`dev` is `prd` minus `railway.internal` URLs and `PORT`, so `doppler run` on a laptop does not get the private Railway Postgres host.

Re-sync (never prints values):

```
bash infra/doppler/sync-from-railway.sh          # mapvest/api → mapvest/prd
python3 infra/doppler/sync-personal-apps.py      # all Railway apps + shared
```

## Same name, one key

Apps keep the env names they already use (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, …). Distinction is the **Doppler project**, not a rename in code.

When the **same underlying token** is on several apps, `shared` stores it once under that name:

- `OPENROUTER_API_KEY` — mapvest, derivation, objetdart, reafference-chat
- `OPENROUTER_BASE_URL`
- `EXA_API_KEY` — mapvest, derivation, GIC `cofounder/prd` (same value)
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` — same Google AI key
- `OPENAI_API_KEY` — inquiry + reafference-chat + GIC `cofounder/prd` (same value)
- `ANTHROPIC_API_KEY` — derivation + objetdart
- `GOOGLE_MAPS_API_KEY` — mapvest
- `RESEARCH_CONSOLE_SERVICE_TOKEN_READ` / `_MUTATE` — mapvest + derivation
- `MASSIVE_API_KEY` — mapvest primary market-data provider; keep only in the
  personal `mapvest` Doppler project and never copy it into repo config

## Same name, different credentials

Do **not** merge these. Apps still read the original name from **their** project. `shared` also keeps the extras as `KEY_APP` so both values exist in one config:

| Name | Canonical (`shared` / majority) | Aliases on `shared` |
|---|---|---|
| `OPENROUTER_API_KEY` | personal majority | `_GIC` (inquiry uses this), `_COMPILER` |
| `ANTHROPIC_API_KEY` | derivation + objetdart | `_GIC` (inquiry), `_COMPILER`, `_UNDERLYING` |
| `OPENAI_API_KEY` | inquiry + GIC | `_COMPILER`, `_OBJETDART`, `_UNDERLYING` |
| `EXA_API_KEY` | mapvest + derivation + GIC | `_UNDERLYING` |
| `HF_TOKEN` | GIC `cofounder/prd` | `_INQUIRY` |
| `MODAL_TOKEN_ID` / `_SECRET` | inquiry + GIC `prd` | `_COMPILER` |
| `STRIPE_SECRET_KEY` | **mapvest only** (test Artesanato Poesia) | GIC live Superoptimizers Stripe stays on GIC. Not copied. |
| `DATABASE_URL` / `POSTGRES_URL` | per app | never in `shared` |
| `INQUIRY_CLOUD_AUTH_SECRET` | site vs api are different | each Doppler project |

No app code changes. Point `doppler setup` at the app’s project.

## What stayed on GIC `cofounder`

Do not copy these into personal Doppler:

- Superoptimizers Stripe, Vercel, Slack, Linear, customer GitHub
- Everett / `cofounder/research` (not Derivation Research Console)
- Customer Supabase, Agentation, Daytona, Pipedream

Derivation’s runtime secrets were already on Railway, not in GIC `research`.

## First-time (this repo)

```bash
doppler login --scope . --overwrite   # workplace "jawaun personal"
doppler setup                         # project mapvest, config dev
doppler run -- bun run dev
```

Sibling checkouts (objetdart, derivation, compiler, …) do not need a new browser login. This worktree already has the personal token:

```bash
python3 infra/doppler/sync-personal-apps.py     # Railway + GIC providers → personal Doppler
python3 infra/doppler/setup-local-repos.py      # scope each local repo, write doppler.yaml
```

`setup-local-repos.py` clones `social-cohesion-vectors` and `underlying-analyzer-reboot` if they are missing. Nested `customer-product-shape-observatory*` dirs stay on GIC `cofounder`. Superoptimizers stays on `cofounder`.
