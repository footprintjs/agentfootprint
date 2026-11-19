"""Add an already checked Docs Demo bundle to an existing static export."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile


MAX_BYTES = 8 * 1024 * 1024
MAX_FILES = 128
ASSET = re.compile(r"assets/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:css|js)")


def actions_get(path):
    repo = os.environ["GITHUB_REPOSITORY"]
    request = Request(
        f"{os.environ['GITHUB_API_URL']}/repos/{repo}/actions/{path}",
        headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    # A ZIP response redirects to signed storage. The token belongs only on the API request.
    request.add_unredirected_header("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
    with urlopen(request, timeout=8) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("GitHub response exceeds the demo size limit")
    return data


def checked_bundle(commit, tree, repository_id):
    query = urlencode(dict(branch="main", event="push", head_sha=commit, status="completed", per_page=1))
    runs = json.loads(actions_get(f"workflows/docs-demo.yml/runs?{query}"))["workflow_runs"]
    if not runs:
        return None

    run = runs[0]
    if (
        run["event"] != "push"
        or run["head_branch"] != "main"
        or run["head_sha"] != commit
        or run["head_commit"]["tree_id"] != tree
        or run["repository"]["id"] != repository_id
        or run["head_repository"]["id"] != repository_id
        or run["status"] != "completed"
        or run["conclusion"] != "success"
    ):
        return None

    run_id = int(run["id"])
    name = f"docs-demo-{int(run['run_attempt'])}"
    artifacts = json.loads(actions_get(f"runs/{run_id}/artifacts?name={name}"))["artifacts"]
    if len(artifacts) != 1:
        return None
    artifact = artifacts[0]
    if artifact["name"] != name or artifact["expired"] or artifact["size_in_bytes"] > MAX_BYTES:
        return None

    payload = actions_get(f"artifacts/{int(artifact['id'])}/zip")
    if artifact["digest"] != f"sha256:{hashlib.sha256(payload).hexdigest()}":
        raise ValueError("demo bundle digest does not match GitHub's record")
    return run_id, payload


def add_bundle(export_dir, payload):
    export_dir = export_dir.resolve()
    route = export_dir / "demo" / "quick-start"
    index = route / "index.html"
    assets = route / "assets"
    if route.resolve() != route or index.is_symlink() or not index.is_file():
        raise ValueError("the export lacks a regular Quick Start fallback")
    if assets.exists() or assets.is_symlink():
        raise ValueError("demo assets would overwrite static content")

    # Stage on the export filesystem. The fallback HTML changes only after all assets land.
    with ZipFile(io.BytesIO(payload)) as archive, TemporaryDirectory(dir=export_dir.parent) as directory:
        staging = Path(directory)
        (staging / "assets").mkdir()
        entries = archive.infolist()
        if len(entries) > MAX_FILES or sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("demo bundle exceeds the file count or unpacked size limit")
        files = set()
        for entry in entries:
            name = entry.orig_filename
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if name == "assets/" and mode in (0, stat.S_IFDIR):
                continue
            if (
                (name != "index.html" and not ASSET.fullmatch(name))
                or mode not in (0, stat.S_IFREG)
                or name in files
                or not entry.file_size
            ):
                raise ValueError("demo bundle contains an unexpected file")
            (staging / name).write_bytes(archive.read(entry))
            files.add(name)
        if "index.html" not in files or not any(name.endswith(".js") for name in files):
            raise ValueError("demo bundle lacks its HTML or JavaScript entry")

        (staging / "assets").rename(assets)
        try:
            (staging / "index.html").replace(index)
        except OSError:
            assets.rename(staging / "assets")
            raise


def main():
    message = "Quick Start demo unavailable. Serving the static fallback."
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
        result = checked_bundle(commit, tree, int(os.environ["GITHUB_REPOSITORY_ID"]))
        if result:
            run_id, payload = result
            add_bundle(Path("docs-next/out"), payload)
            message = f"Added the checked Quick Start demo from advisory run {run_id}."
    except (OSError, ValueError, KeyError, TypeError, BadZipFile, subprocess.CalledProcessError) as error:
        print(f"Quick Start demo lookup or overlay failed: {error}")

    print(message)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(message + "\n")


if __name__ == "__main__":
    main()
