#!/usr/bin/env python3
"""Copy Jawaun's Railway apps + needed GIC provider tokens into personal Doppler.

Never prints secret values. Refuses to run against the GIC workplace.

Layout:
  shared/prd              provider tokens that are the same underlying credential
  shared/prd KEY_GIC      GIC value when the same name is a different credential
  <app>/prd               that Railway service's runtime vars (authoritative)
  <app>/prd_<svc>         extra services in the same Railway project
  <app>/dev               same as prd minus railway.internal URLs (local doppler run)

Same env var name is fine across projects (OPENROUTER_API_KEY in mapvest vs
inquiry-black-box). Only `shared` uses KEY_GIC aliases so both values can live
in one config without overwriting.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCOPE = str(ROOT)
GIC_SCOPE = os.environ.get("GIC_DOPPLER_SCOPE", "/Users/jawaun/superoptimizers")

os.environ.setdefault("RAILWAY_CALLER", "skill:use-railway@1.3.0")
os.environ.setdefault("RAILWAY_AGENT_SESSION", "doppler-personal-sync")

SKIP_KEY = re.compile(r"^(RAILWAY_|DOPPLER_)")
SKIP_SERVICES = {"Postgres", "postgres"}
INTERNAL = re.compile(r"railway\.internal", re.I)

# GIC product / customer / org integrations. Stay on GIC `cofounder`.
GIC_DENY = re.compile(
    r"(CUSTOMER_|VERCEL_|COFOUNDER_|SUPEROPTIMIZERS|PIPEDREAM|COMPOSIO|NANGO|"
    r"SHOPIFY|STRIPE_|NEXT_PUBLIC_STRIPE|BILLING_ENABLED|AGENTATION_|DAYTONA_|"
    r"DROPSPACE_|MEMORY_ONBOARDING|FLYTRAP_|NYNE_|EVERETT_|EC_|SLACK_|LINEAR_|"
    r"DISCORD_|GITHUB_|AWS_|DD_|SENTRY_|NOTION_|FIGMA_|REDDIT_|SUPABASE|"
    r"NEXT_PUBLIC_SUPABASE|MERCURY_|META_MARKETING|EXPENSIFY_|AIRTABLE_|"
    r"ATTIO_|CALENDAR_|C1_EMAIL|DEVIN_|DISABLE_FLOW|DB_URL$)"
)

# Provider keys personal apps actually call (or may need locally).
# Provider credentials only (not model ids / flags).
GIC_ALLOW = re.compile(
    r"^(ANTHROPIC_API_KEY|ANTHROPIC_EVALS_API_KEY|OPENAI_API_KEY|OPENROUTER_|"
    r"EXA_API_KEY|EXA_WEBHOOK_SECRET|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_MAPS_API_KEY|"
    r"HF_TOKEN|HUGGINGFACE_TOKEN|VOYAGE_API_KEY|GROQ_API_KEY|CEREBRAS_API_KEY|"
    r"PERPLEXITY_API_KEY|FIRECRAWL_|MODAL_TOKEN_|BROWSERBASE_|E2B_|APIFY_|"
    r"CHROMA_|LANGSMITH_|RESEND_API_KEY|LLAMAPARSE_|MEM0_|RAGIE_|STITCH_|"
    r"GAMMA_|LAYERS_|MAILSLURP_|AVIATIONSTACK_|APOLLO_|OPENWEATHER_|TWELVEDATA_|"
    r"TENSORLAKE_|VERS_SH_|AI_GATEWAY_|RESEARCH_CONSOLE_SERVICE_TOKEN_)"
)

RAILWAY_PROJECTS = [
    ("mapvest", "6c776d1f-1604-4cfe-a664-410bafe65455"),
    ("compiler-tomography", "34c39cdd-c009-40cd-9811-9de17c279cd4"),
    ("structural-observatory", "c17b4032-bbbe-474d-b701-a69479403070"),
    ("reafference-chat", "adcde49b-7606-4a5d-b6bf-b1efe41e3c4b"),
    ("conjecture-lab", "d0eed084-0647-41bd-a938-873917d3301b"),
    ("envelope-guard", "31f7bc34-f4f0-4782-8a95-7ca3f4d8b5cb"),
    ("customer-product-shape-galaxy", "d3321102-d134-4c38-8d98-49493e8a991a"),
    ("derivation-research-console", "9141bdd0-f400-4893-be18-7eb27d3087a0"),
    ("wave-morphism", "e70d4b06-1d4f-4532-a7a4-75d9016fa454"),
    ("inquiry-black-box-site", "520094f1-620a-436c-953f-26273416786e"),
    ("resolutionbench", "a37d5346-fa2c-4d34-bdd1-d513cd71c78e"),
    ("inquiry-black-box", "4fb087a7-0c67-420a-be06-3a19720af6a7"),
    ("neurophenom-site", "6990d94f-947d-45a1-b83e-eb5ccdb1d032"),
    ("resolutionbench-site", "9da2ef51-563b-4401-a7df-c52f380fb383"),
    ("philo-video-brainlab", "753d7bbc-ea1b-4a5b-b81d-69588b351496"),
    ("social-cohesion-vectors", "6e25c7ca-e390-44f0-ad15-3fb49bf0c0e0"),
    ("reafference-attribution-field", "2fd18d7f-bf1b-42ae-b756-d29f836cb1d9"),
    ("objetdart", "b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe"),
    ("underlying-terminal", "433ac17d-e943-4daf-87c0-3b6b2c6dfe38"),
]

PROJECT_ALIAS = {
    "compiler-tomography": "COMPILER",
    "inquiry-black-box": "INQUIRY",
    "objetdart": "OBJETDART",
    "underlying-terminal": "UNDERLYING",
    "reafference-chat": "REAFFERENCE",
    "mapvest": "MAPVEST",
    "derivation-research-console": "DERIVATION",
}

PRIMARY_SERVICE = {
    "mapvest": "api",
    "reafference-chat": "web",
    "conjecture-lab": "web",
    "inquiry-black-box": "inquiry-black-box-api",
    "underlying-terminal": "underlying-terminal",
}


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    p = subprocess.run(args, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{p.stderr.strip()[:400]}")
    return p


def digest(val: str) -> str:
    return hashlib.sha256(val.encode()).hexdigest()[:12]


def workplace_ok() -> None:
    me = json.loads(run(["doppler", "me", "--json", "--scope", SCOPE]).stdout)
    wp = me.get("workplace") or {}
    name = wp.get("name") if isinstance(wp, dict) else str(wp)
    if re.search(r"general intelligence", str(name), re.I):
        sys.exit(
            "Doppler CLI is on the GIC workplace. "
            f"doppler login --scope {SCOPE} --overwrite  (jawaun personal)"
        )


_PROJECTS: set[str] | None = None
_CONFIGS: dict[str, set[str]] = {}


def existing_projects() -> set[str]:
    global _PROJECTS
    if _PROJECTS is None:
        data = json.loads(run(["doppler", "projects", "--json", "--scope", SCOPE]).stdout)
        _PROJECTS = {p.get("id") or p.get("name") for p in data}
    return _PROJECTS


def ensure_project(name: str, description: str) -> None:
    if name in existing_projects():
        return
    print(f"creating doppler project {name}", file=sys.stderr)
    run(
        [
            "doppler",
            "projects",
            "create",
            name,
            "--description",
            description,
            "--scope",
            SCOPE,
            "--silent",
        ]
    )
    existing_projects().add(name)


def existing_configs(project: str) -> set[str]:
    if project not in _CONFIGS:
        data = json.loads(
            run(
                ["doppler", "configs", "--json", "--project", project, "--scope", SCOPE]
            ).stdout
        )
        _CONFIGS[project] = {c.get("name") for c in data}
    return _CONFIGS[project]


def ensure_config(project: str, name: str, environment: str) -> None:
    if name in existing_configs(project):
        return
    print(f"creating config {project}/{name}", file=sys.stderr)
    run(
        [
            "doppler",
            "configs",
            "create",
            name,
            "--project",
            project,
            "--environment",
            environment,
            "--scope",
            SCOPE,
            "--silent",
        ]
    )
    existing_configs(project).add(name)


def upload(project: str, config: str, secrets: dict[str, str]) -> int:
    cleaned = {}
    for k, v in secrets.items():
        if SKIP_KEY.match(k) or v is None:
            continue
        text = str(v)
        if text == "" or text.startswith("${{"):
            continue
        cleaned[k] = text
    if not cleaned:
        print(f"{project}/{config}: 0 keys", file=sys.stderr)
        return 0
    fd, path = tempfile.mkstemp(prefix="doppler-sync-", suffix=".json")
    os.close(fd)
    os.chmod(path, 0o600)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cleaned, f)
        run(
            [
                "doppler",
                "secrets",
                "upload",
                path,
                "--project",
                project,
                "--config",
                config,
                "--scope",
                SCOPE,
                "--silent",
            ]
        )
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    print(f"{project}/{config}: uploaded {len(cleaned)} keys", file=sys.stderr)
    return len(cleaned)


def railway_services(project_id: str) -> list[str]:
    out = run(
        [
            "railway",
            "service",
            "list",
            "--project",
            project_id,
            "--environment",
            "production",
            "--json",
        ]
    ).stdout
    data = json.loads(out)
    names = []
    for s in data if isinstance(data, list) else []:
        n = s.get("name") if isinstance(s, dict) else str(s)
        if n not in SKIP_SERVICES:
            names.append(n)
    return names


def railway_vars(project_id: str, service: str) -> dict[str, str]:
    out = run(
        [
            "railway",
            "variable",
            "list",
            "--json",
            "--project",
            project_id,
            "--environment",
            "production",
            "--service",
            service,
        ]
    ).stdout
    raw = json.loads(out)
    return {k: str(v) for k, v in raw.items() if not SKIP_KEY.match(k) and v is not None and str(v) != ""}


def doppler_download(scope: str, project: str, config: str) -> dict[str, str]:
    p = run(
        [
            "doppler",
            "secrets",
            "download",
            "--project",
            project,
            "--config",
            config,
            "--scope",
            scope,
            "--format",
            "json",
            "--no-file",
        ],
        check=False,
    )
    if p.returncode != 0:
        print(f"skip gic {project}/{config}: {p.stderr.strip()[:160]}", file=sys.stderr)
        return {}
    data = json.loads(p.stdout)
    return {k: str(v) for k, v in data.items() if not SKIP_KEY.match(k)}


def config_for_service(project: str, service: str, services: list[str]) -> str:
    primary = PRIMARY_SERVICE.get(project, project if project in services else services[0] if services else service)
    if service == primary:
        return "prd"
    slug = re.sub(r"[^a-z0-9]+", "_", service.lower()).strip("_")[:24]
    return f"prd_{slug}"


def for_dev(secrets: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in secrets.items():
        if INTERNAL.search(v):
            continue
        if k == "PORT":
            continue
        out[k] = v
    return out


def majority_by_key(rail: dict[tuple[str, str], dict[str, str]]) -> dict[str, str]:
    """Value shared by the most Railway services; ties keep the first seen."""
    groups: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for (proj, svc), secrets in rail.items():
        loc = f"{proj}/{svc}"
        for k, v in secrets.items():
            if not GIC_ALLOW.search(k):
                continue
            groups[k][digest(v)].append(loc)
    chosen = {}
    for k, by_hash in groups.items():
        want = max(by_hash, key=lambda h: len(by_hash[h]))
        if len(by_hash[want]) < 2:
            continue
        for secrets in rail.values():
            if k in secrets and digest(secrets[k]) == want:
                chosen[k] = secrets[k]
                break
    return chosen


def build_shared(majority: dict[str, str], gic_prd: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    shared = dict(majority)
    notes = []
    for k, v in sorted(gic_prd.items()):
        if GIC_DENY.search(k) or not GIC_ALLOW.search(k):
            continue
        if k in shared:
            if shared[k] == v:
                notes.append(f"SAME {k} (personal majority == gic prd)")
            else:
                alias = f"{k}_GIC"
                shared[alias] = v
                notes.append(f"ALIAS {alias}  (gic prd differs from personal majority {k})")
        else:
            shared[k] = v
            notes.append(f"GIC-ONLY {k} -> shared as {k}")
    return shared, notes


def add_railway_aliases(
    shared: dict[str, str],
    notes: list[str],
    rail: dict[tuple[str, str], dict[str, str]],
    majority: dict[str, str],
) -> None:
    """Put distinct per-app provider tokens on shared as KEY_APP so both values exist."""
    for (proj, svc), secrets in rail.items():
        suffix = PROJECT_ALIAS.get(proj)
        if not suffix:
            continue
        for k, v in secrets.items():
            if not GIC_ALLOW.search(k):
                continue
            if majority.get(k) == v:
                continue
            if shared.get(k) == v:
                continue
            if k not in shared:
                shared[k] = v
                notes.append(f"APP-ONLY {k} from {proj}/{svc}")
                continue
            if any(sv == v and (sk == k or sk.startswith(k + "_")) for sk, sv in shared.items()):
                continue
            alias = f"{k}_{suffix}"
            if alias in shared and shared[alias] != v:
                notes.append(f"SKIP collide {alias}")
                continue
            shared[alias] = v
            notes.append(f"ALIAS {alias}  ({proj}/{svc} differs from majority/shared {k})")


def main() -> None:
    workplace_ok()
    print("fetching Railway vars…", file=sys.stderr)
    rail: dict[tuple[str, str], dict[str, str]] = {}
    services_by_project: dict[str, list[str]] = {}
    for name, pid in RAILWAY_PROJECTS:
        svcs = railway_services(pid)
        services_by_project[name] = svcs
        for svc in svcs:
            rail[(name, svc)] = railway_vars(pid, svc)

    print("fetching GIC cofounder/prd provider names…", file=sys.stderr)
    gic_prd = doppler_download(GIC_SCOPE, "cofounder", "prd")

    majority = majority_by_key(rail)
    shared, notes = build_shared(majority, gic_prd)
    add_railway_aliases(shared, notes, rail, majority)

    ensure_project("shared", "Provider tokens shared across Jawaun personal Railway apps")
    n_shared = upload("shared", "prd", shared)
    n_shared_dev = upload("shared", "dev", for_dev(shared))

    summary = []
    for name, pid in RAILWAY_PROJECTS:
        svcs = services_by_project[name]
        ensure_project(name, f"Railway project {name} production secrets")
        if not svcs:
            summary.append(f"{name}: no app services")
            continue
        for svc in svcs:
            cfg = config_for_service(name, svc, svcs)
            if cfg != "prd":
                ensure_config(name, cfg, "prd")
            secrets = rail[(name, svc)]
            n = upload(name, cfg, secrets)
            if cfg == "prd":
                nd = upload(name, "dev", for_dev(secrets))
                summary.append(f"{name}/{svc} -> {name}/prd ({n})  dev ({nd})")
            else:
                summary.append(f"{name}/{svc} -> {name}/{cfg} ({n})")

    print("\n## shared aliases / gic overlay")
    for line in notes:
        print(line)
    print(f"\nshared/prd {n_shared} keys  shared/dev {n_shared_dev} keys")
    print("\n## per-app")
    for line in summary:
        print(line)

    # Conflict report: same name, different hashes across Railway
    print("\n## same-name different-value (kept per Doppler project; no app rename)")
    by_key: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for (proj, svc), secrets in rail.items():
        for k, v in secrets.items():
            by_key[k][digest(v)].append(f"{proj}/{svc}")
    if "STRIPE_SECRET_KEY" in gic_prd:
        by_key["STRIPE_SECRET_KEY"][digest(gic_prd["STRIPE_SECRET_KEY"])].append("gic:cofounder/prd")
    for k, groups in sorted(by_key.items()):
        if len(groups) < 2:
            continue
        print(f"  {k}")
        for h, locs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            print(f"    {h}  {', '.join(locs)}")


if __name__ == "__main__":
    main()
