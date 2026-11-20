import hashlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from deploy_docs_demo import add_bundle, checked_bundle, MAX_BYTES


def archive_bytes(extra=None):
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("index.html", "interactive demo")
        archive.writestr("assets/index-test.js", "demo code")
        if extra:
            archive.writestr(extra, "unexpected file")
    return buffer.getvalue()


class PagesDemoTest(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.export = Path(directory) / "out"
        self.route = self.export / "demo" / "quick-start"
        self.route.mkdir(parents=True)
        self.index = self.route / "index.html"
        self.index.write_text("static fallback")
        self.run = {
            "event": "push",
            "head_branch": "main",
            "head_sha": "commit",
            "head_commit": {"tree_id": "tree"},
            "repository": {"id": 5},
            "head_repository": {"id": 5},
            "status": "completed",
            "conclusion": "success",
            "id": 12,
            "run_attempt": 2,
        }
        self.payload = archive_bytes()
        self.artifact = {
            "id": 23,
            "name": "docs-demo-2",
            "expired": False,
            "size_in_bytes": len(self.payload),
            "digest": f"sha256:{hashlib.sha256(self.payload).hexdigest()}",
        }

    def test_checked_same_tree_bundle_replaces_only_the_fallback(self):
        other = self.export / "index.html"
        other.write_text("static site")
        responses = [
            json.dumps({"workflow_runs": [self.run]}),
            json.dumps({"artifacts": [self.artifact]}),
            self.payload,
        ]
        with patch("deploy_docs_demo.actions_get", side_effect=responses) as get:
            run_id, payload = checked_bundle("commit", "tree", 5)
        self.assertEqual(run_id, 12)
        self.assertEqual(get.call_args_list[1].args, ("runs/12/artifacts?name=docs-demo-2",))
        self.assertEqual(get.call_args_list[2].args, ("artifacts/23/zip",))
        add_bundle(self.export, payload)
        self.assertEqual(self.index.read_text(), "interactive demo")
        self.assertEqual((self.route / "assets/index-test.js").read_text(), "demo code")
        self.assertEqual(other.read_text(), "static site")

    def test_missing_failed_or_untrusted_run_requires_no_artifact_request(self):
        for runs in [
            [],
            [{**self.run, "status": "in_progress"}],
            [{**self.run, "conclusion": "failure"}],
            [{**self.run, "event": "pull_request"}],
            [{**self.run, "head_sha": "different commit"}],
            [{**self.run, "head_commit": {"tree_id": "different tree"}}],
            [{**self.run, "head_repository": {"id": 6}}],
        ]:
            with self.subTest(runs=runs), patch(
                "deploy_docs_demo.actions_get", return_value=json.dumps({"workflow_runs": runs})
            ) as get:
                self.assertIsNone(checked_bundle("commit", "tree", 5))
                get.assert_called_once()
                self.assertEqual(self.index.read_text(), "static fallback")

    def test_missing_expired_stale_or_oversize_artifact_requires_no_download(self):
        for artifacts in [
            [],
            [{**self.artifact, "expired": True}],
            [{**self.artifact, "name": "docs-demo-1"}],
            [{**self.artifact, "size_in_bytes": MAX_BYTES + 1}],
        ]:
            responses = [json.dumps({"workflow_runs": [self.run]}), json.dumps({"artifacts": artifacts})]
            with self.subTest(artifacts=artifacts), patch(
                "deploy_docs_demo.actions_get", side_effect=responses
            ) as get:
                self.assertIsNone(checked_bundle("commit", "tree", 5))
                self.assertEqual(get.call_count, 2)

    def test_altered_download_is_rejected(self):
        responses = [
            json.dumps({"workflow_runs": [self.run]}),
            json.dumps({"artifacts": [self.artifact]}),
            self.payload + b"altered",
        ]
        with patch("deploy_docs_demo.actions_get", side_effect=responses), self.assertRaisesRegex(
            ValueError, "digest does not match"
        ):
            checked_bundle("commit", "tree", 5)

    def test_unexpected_asset_keeps_the_static_fallback(self):
        with self.assertRaisesRegex(ValueError, "unexpected file"):
            add_bundle(self.export, archive_bytes("another-route.html"))
        self.assertEqual(self.index.read_text(), "static fallback")
        self.assertFalse((self.route / "assets").exists())
