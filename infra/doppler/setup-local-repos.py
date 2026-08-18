#!/usr/bin/env python3
"""Point local checkouts of Jawaun's Railway apps at personal Doppler.

Copies the personal-workplace CLI token from this Mapvest worktree onto each
repo scope (no browser login). Writes doppler.yaml. Does not print tokens.

Nested GIC work inside option_derivation (customer-product-shape-observatory*)
is pinned back to the GIC token + cofounder so it does not inherit personal.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

MAPVEST_SCOPE = Path("/Users/jawaun/.cursor/worktrees/mapvest/6rg9")
HOME = Path.home()

# Local checkout → personal Doppler project. Missing paths are skipped.
PERSONAL_REPOS: list[tuple[Path, str]] = [
    (HOME / "mapvest", "mapvest"),
    (MAPVEST_SCOPE, "mapvest"),
    (HOME / "objetdart_proj", "objetdart"),
    (HOME / "option_derivation", "derivation-research-console"),
    (HOME / "compiler-tomography", "compiler-tomography"),
    (HOME / "conjecture-lab", "conjecture-lab"),
    (HOME / "wave-morphism", "wave-morphism"),
    (HOME / "resolutionbench", "resolutionbench"),
    (HOME / "social-cohesion-vectors", "social-cohesion-vectors"),
    (HOME / "underlying-analyzer-reboot", "underlying-terminal"),
]

CLONE_IF_MISSING = [
    ("jawauntb/social-cohesion-vectors", HOME / "social-cohesion-vectors"),
    ("jawauntb/underlying-analyzer-reboot", HOME / "underlying-analyzer-reboot"),
]

CURSOR_WORKTREES = [
    (HOME / ".cursor/worktrees/mapvest", "mapvest"),
    (HOME / ".cursor/worktrees/objetdart_proj", "objetdart"),
    (HOME / ".cursor/worktrees/option_derivation", "derivation-research-console"),
]

GIC_NEST_PREFIX = "customer-product-shape-observatory"


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    p = subprocess.run(args, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:6])}…\n{p.stderr.strip()[:400]}")
    return p


def get_token(scope: Path | str) -> str:
    p = run(["doppler", "configure", "get", "token", "--plain", "--scope", str(scope)])
    token = p.stdout.strip()
    if not token.startswith("dp."):
        sys.exit(f"Refusing to copy a non-Doppler token from {scope}")
    return token


def workplace_name(scope: Path) -> str:
    p = run(["doppler", "me", "--json", "--scope", str(scope)], check=False)
    if p.returncode != 0:
        return f"ERROR {p.stderr.strip()[:120]}"
    me = json.loads(p.stdout)
    wp = me.get("workplace") or {}
    if isinstance(wp, dict):
        return str(wp.get("name") or wp)
    return str(wp)


def write_repo_doppler_yaml(repo: Path, project: str) -> None:
    path = repo / "doppler.yaml"
    path.write_text(
        "# Personal workplace (jawaun personal). Not GIC cofounder.\n"
        "setup:\n"
        f"  project: {project}\n"
        "  config: dev\n"
    )


def set_scope_token(path: Path, token: str) -> None:
    run(
        [
            "doppler",
            "configure",
            "set",
            f"token={token}",
            "--scope",
            str(path),
            "--silent",
        ]
    )


def setup_project(path: Path, project: str, config: str) -> None:
    run(
        [
            "doppler",
            "configure",
            "set",
            f"project={project}",
            f"config={config}",
            "--scope",
            str(path),
            "--silent",
        ]
    )
    run(
        [
            "doppler",
            "setup",
            "--project",
            project,
            "--config",
            config,
            "--no-interactive",
            "--scope",
            str(path),
            "--silent",
        ]
    )


def existing_worktrees(root: Path, project: str) -> list[tuple[Path, str]]:
    out = []
    if not root.is_dir():
        return out
    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / ".git").exists():
            out.append((child, project))
    return out


def main() -> None:
    personal_token = get_token(MAPVEST_SCOPE)
    gic_token = get_token("/")

    for slug, dest in CLONE_IF_MISSING:
        if dest.exists():
            continue
        print(f"cloning {slug} -> {dest}", file=sys.stderr)
        run(["gh", "repo", "clone", slug, str(dest)])

    targets: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for path, project in PERSONAL_REPOS:
        if path.exists() and str(path) not in seen:
            targets.append((path, project))
            seen.add(str(path))
    for root, project in CURSOR_WORKTREES:
        for path, proj in existing_worktrees(root, project):
            if str(path) not in seen:
                targets.append((path, proj))
                seen.add(str(path))

    print("## personal Doppler scopes")
    for path, project in targets:
        set_scope_token(path, personal_token)
        write_repo_doppler_yaml(path, project)
        setup_project(path, project, "dev")
        wp = workplace_name(path)
        names = run(
            [
                "doppler",
                "secrets",
                "--only-names",
                "--scope",
                str(path),
                "--project",
                project,
                "--config",
                "dev",
            ],
            check=False,
        )
        nkeys = sum(
            1
            for line in names.stdout.splitlines()
            if line.strip().startswith("│")
            and "NAME" not in line
            and "──" not in line
        )
        ok = ("jawaun personal" in wp.lower() or "jawaun person" in wp.lower()) and names.returncode == 0
        status = "OK" if ok else "FAIL"
        print(f"{status}  {path}")
        print(f"     workplace={wp}  project={project}/dev  named_keys≈{nkeys}")
        if not ok:
            sys.exit(1)

    # Pin nested GIC observatory checkouts so they do not inherit personal token.
    print("\n## GIC nested scopes (stay on cofounder)")
    deriv = HOME / "option_derivation"
    nests = []
    if deriv.is_dir():
        nests.extend(sorted(deriv.glob(f"{GIC_NEST_PREFIX}*")))
    nested_root = HOME / "customer-product-shape-observatory"
    if nested_root.exists():
        nests.append(nested_root)
    for nest in nests:
        if not nest.is_dir():
            continue
        set_scope_token(nest, gic_token)
        setup_project(nest, "cofounder", "dev")
        wp = workplace_name(nest)
        ok = "general intelligence" in wp.lower()
        status = "OK" if ok else "FAIL"
        print(f"{status}  {nest}")
        print(f"     workplace={wp}  project=cofounder")
        if not ok:
            sys.exit(1)

    print("\ndone")


if __name__ == "__main__":
    main()
