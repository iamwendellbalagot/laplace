"""Disposable feasibility proofs, NOT application code. Python 3 + Git + Node/npm.

All mutations are confined to repositories created by this test run. Integration
deliberately supports only a non-checked-out destination branch. It is NOT a
solution for updating a user's active index/working tree atomically.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import unittest


def run(cwd, *args, input=None):
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_AUTHOR_NAME="Laplace fixture", GIT_AUTHOR_EMAIL="fixture@invalid",
               GIT_COMMITTER_NAME="Laplace fixture", GIT_COMMITTER_EMAIL="fixture@invalid",
               GIT_TERMINAL_PROMPT="0")
    return subprocess.run(args, cwd=cwd, env=env, input=input, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True, timeout=30).stdout


def git(cwd, *args, input=None):
    return run(cwd, "git", "-c", "core.hooksPath=" + os.devnull, *args, input=input)


def manifest(root):
    """Versioned saved-byte identity; ignores caches/secrets by explicit policy.

    Reject symlinks (including ancestors) rather than following them. UTF-8 path
    support only in this probe; production must define non-UTF-8 path handling.
    This detects many concurrent edits but is not an atomic filesystem snapshot.
    """
    root = Path(root).resolve()
    paths = sorted(set(git(root, "ls-files", "-z", "--cached", "--others",
                           "--exclude-standard").split(b"\0")) - {b""})
    entries = []
    for raw in paths:
        name = raw.decode("utf-8")
        parts = Path(name).parts
        if Path(name).is_absolute() or ".." in parts:
            raise ValueError("Unsafe repository path")
        if any(p in {".git", ".rook", ".pi", ".ssh", "node_modules", "target"}
               or p == ".env" or p.startswith(".env.") or p.endswith(".pem") for p in parts):
            continue
        path = root
        for part in parts:
            path = path / part
            if path.is_symlink():
                raise ValueError("Symlinks are unsupported by this probe")
        if not path.exists():
            entries.append([name, "deleted"])
            continue
        before = path.stat()
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Only regular files are supported")
        data = path.read_bytes()
        after = path.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode) != (
                after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode):
            raise ValueError("Source changed while being captured")
        entries.append([name, bool(after.st_mode & stat.S_IXUSR),
                        hashlib.sha256(data).hexdigest()])
    payload = {"schema": 1, "head": git(root, "rev-parse", "HEAD").decode().strip(),
               "exclusionPolicy": "probe-v1", "entries": entries}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest(), payload


def squash_proposal(repo, candidate, expected, expected_source, *, publish=True):
    """Make a squash commit and CAS a non-checked-out refs/heads/destination.

    The repository and branch name are owned by this fixture. An unreachable
    commit after a failed publish is harmless; callers can inspect/retry it.
    """
    target = "refs/heads/destination"
    worktrees = git(repo, "worktree", "list", "--porcelain").decode()
    if "branch " + target + "\n" in worktrees:
        raise ValueError("Refuse to update a checked-out destination")
    if git(repo, "rev-parse", target).decode().strip() != expected:
        raise ValueError("Destination advanced; review again")
    if manifest(candidate)[0] != expected_source:
        raise ValueError("Candidate changed; invalidate evidence and approval")
    if git(candidate, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Commit the candidate before this integration probe")
    head = git(candidate, "rev-parse", "HEAD").decode().strip()
    # merge-tree performs a real three-way merge without touching an index/worktree.
    tree = git(repo, "merge-tree", "--write-tree", expected, head).splitlines()[0]
    commit = git(repo, "commit-tree", tree.decode(), "-p", expected,
                 input=b"Feasibility squash\n").decode().strip()
    if publish:
        git(repo, "update-ref", target, commit, expected)
    return commit, tree.decode()


class Feasibility(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="laplace-01-", dir=os.getenv("TMPDIR"))
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo with spaces"
        self.repo.mkdir()
        git(self.repo, "init", "-b", "main")
        (self.repo / ".gitignore").write_text("node_modules/\n.env\n")
        (self.repo / "source.mjs").write_text("export const answer = 41;\n")
        (self.repo / "package.json").write_text(json.dumps({
            "name": "laplace-feasibility-fixture", "version": "1.0.0", "private": True,
            "scripts": {"test": "node --test"}}))
        (self.repo / "source.test.mjs").write_text(
            "import {test} from 'node:test'; import {strict as a} from 'node:assert';\n"
            "import {answer} from './source.mjs'; test('answer', () => a.equal(answer, 41));\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "Fixture base")
        self.base = git(self.repo, "rev-parse", "HEAD").decode().strip()
        git(self.repo, "branch", "destination")
        self.candidate = self.root / "candidate"
        git(self.repo, "worktree", "add", "-b", "candidate", str(self.candidate))

    def tearDown(self):
        # Only the exact TemporaryDirectory created above is removed.
        self.temp.cleanup()

    def commit_candidate(self):
        (self.candidate / "feature.txt").write_text("candidate\n")
        git(self.candidate, "add", ".")
        git(self.candidate, "commit", "-m", "Candidate")
        return manifest(self.candidate)[0]

    def test_worktree_node_setup_and_cleanup(self):
        self.assertTrue(shutil.which("node") and shutil.which("npm"))
        run(self.candidate, "npm", "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund")
        self.assertTrue((self.candidate / "package-lock.json").is_file())
        run(self.candidate, "npm", "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund")
        self.assertIn(b"pass 1", run(self.candidate, "npm", "test"))
        self.assertFalse((self.repo / "package-lock.json").exists())
        # Preserve the generated file until explicitly removing only this fixture file.
        (self.candidate / "package-lock.json").unlink()
        git(self.repo, "worktree", "remove", str(self.candidate))
        self.assertFalse(self.candidate.exists())

    def test_manifest_determinism_unsaved_untracked_config_lock_and_delete(self):
        initial = manifest(self.candidate)[0]
        self.assertEqual(initial, manifest(self.candidate)[0])
        unsaved_buffer = "not written to disk"
        self.assertEqual(initial, manifest(self.candidate)[0], unsaved_buffer)
        for name in ["untracked.txt", "tsconfig.json", "package-lock.json", "space\n雪.txt"]:
            (self.candidate / name).write_text("changed\n")
            updated = manifest(self.candidate)[0]
            self.assertNotEqual(initial, updated)
            initial = updated
        (self.candidate / "source.mjs").unlink()
        self.assertNotEqual(initial, manifest(self.candidate)[0])

    def test_manifest_excludes_ignored_and_sensitive_files(self):
        initial = manifest(self.candidate)[0]
        (self.candidate / ".env").write_text("FIXTURE_ONLY=not-a-secret\n")
        (self.candidate / "node_modules").mkdir()
        (self.candidate / "node_modules" / "cache").write_text("cache\n")
        self.assertEqual(initial, manifest(self.candidate)[0])
        git(self.candidate, "add", "-f", ".env")
        self.assertEqual(initial, manifest(self.candidate)[0])

    def test_manifest_rejects_symlink_escape(self):
        (self.root / "outside").write_text("outside\n")
        (self.candidate / "escape").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            manifest(self.candidate)

    def test_squash_has_exact_tree_and_one_destination_parent(self):
        source = self.commit_candidate()
        before = manifest(self.repo)[0]
        commit, tree = squash_proposal(self.repo, self.candidate, self.base, source)
        self.assertEqual(git(self.repo, "rev-parse", "destination^{tree}").decode().strip(), tree)
        self.assertEqual(git(self.repo, "rev-parse", commit + "^@").decode().strip(), self.base)
        self.assertEqual(manifest(self.repo)[0], before)
        self.assertEqual(git(self.repo, "status", "--porcelain"), b"")

    def test_source_mutation_invalidates_approval(self):
        source = self.commit_candidate()
        (self.candidate / "new.txt").write_text("new source\n")
        with self.assertRaisesRegex(ValueError, "Candidate changed"):
            squash_proposal(self.repo, self.candidate, self.base, source)

    def test_destination_advancement_invalidates_review(self):
        source = self.commit_candidate()
        advanced = git(self.repo, "commit-tree", "HEAD^{tree}", "-p", "HEAD", input=b"Advance\n").decode().strip()
        git(self.repo, "update-ref", "refs/heads/destination", advanced, self.base)
        with self.assertRaisesRegex(ValueError, "Destination advanced"):
            squash_proposal(self.repo, self.candidate, self.base, source)

    def test_partial_failure_and_compare_and_swap(self):
        source = self.commit_candidate()
        orphan, _ = squash_proposal(self.repo, self.candidate, self.base, source, publish=False)
        self.assertEqual(git(self.repo, "rev-parse", "destination").decode().strip(), self.base)
        # Retry can publish a prepared commit only while the expected ref still matches.
        git(self.repo, "update-ref", "refs/heads/destination", orphan, self.base)
        with self.assertRaises(subprocess.CalledProcessError):
            git(self.repo, "update-ref", "refs/heads/destination", self.base, self.base)
        self.assertEqual(git(self.repo, "rev-parse", "destination").decode().strip(), orphan)

    def test_merge_conflict_does_not_mutate_destination(self):
        (self.candidate / "source.mjs").write_text("candidate conflict\n")
        git(self.candidate, "add", ".")
        git(self.candidate, "commit", "-m", "Candidate conflict")
        (self.repo / "source.mjs").write_text("target conflict\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "Target conflict")
        target = git(self.repo, "rev-parse", "HEAD").decode().strip()
        git(self.repo, "update-ref", "refs/heads/destination", target, self.base)
        before = manifest(self.repo)[0]
        with self.assertRaises(subprocess.CalledProcessError):
            squash_proposal(self.repo, self.candidate, target, manifest(self.candidate)[0])
        self.assertEqual(manifest(self.repo)[0], before)
        self.assertEqual(git(self.repo, "rev-parse", "destination").decode().strip(), target)

    def test_checked_out_destination_is_refused(self):
        source = self.commit_candidate()
        git(self.repo, "worktree", "add", str(self.root / "destination"), "destination")
        with self.assertRaisesRegex(ValueError, "checked-out"):
            squash_proposal(self.repo, self.candidate, self.base, source)


if __name__ == "__main__":
    started = time.monotonic()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Feasibility)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({"platform": os.uname().sysname if hasattr(os, "uname") else os.name,
                      "tests": result.testsRun, "seconds": round(time.monotonic() - started, 3),
                      "passed": result.wasSuccessful()}))
    raise SystemExit(not result.wasSuccessful())
