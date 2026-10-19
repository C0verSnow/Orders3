"""CI-only regression: execute the real deploy command through a local SSH double.

No credentials, network, Docker engine, or application build are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
STARTUP = '''#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$PWD" "$0" "$ORDERS_IMAGE" > executed
exit "${STARTUP_EXIT:-0}"
'''


class DeploySSHTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "checkout"
        (self.repo / "scripts").mkdir(parents=True)
        shutil.copy(REPO / "scripts/deploy-ssh.sh", self.repo / "scripts")
        # Different content at the legacy path catches uploading the wrong file.
        (self.repo / "scripts/start-docker.sh").write_text("exit 97\n")
        self.startup = self.repo / "start-docker.sh"
        self.startup.write_text(STARTUP)
        self.home = self.base / "remote home with spaces"
        self.home.mkdir()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        ssh = self.bin / "ssh"
        ssh.write_text('''#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
Path(os.environ["SSH_ARGS"]).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("SSH_FAIL"):
    sys.exit(255)
sys.exit(subprocess.run(["bash", "-c", sys.argv[-1]]).returncode)
''')
        ssh.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "HOME": str(self.home),
            "SSH_ARGS": str(self.base / "ssh-args.json"),
            "DEPLOY_HOST": "server.example",
            "DEPLOY_USER": "deploy",
            "DEPLOY_PORT": "2222",
            "DEPLOY_SSH_KEY": "test-only-not-a-key",
            "DEPLOY_KNOWN_HOSTS": "server.example test-only-host-key",
            "ORDERS_IMAGE": "ghcr.io/c0versnow/orders3:latest",
        }

    def deploy(self, **env):
        return subprocess.run(
            ["bash", str(self.repo / "scripts/deploy-ssh.sh")],
            cwd=self.base, env={**self.env, **env},
            text=True, capture_output=True, timeout=10,
        )

    def assert_started(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / "start-docker.sh").read_text(), self.startup.read_text())
        self.assertEqual((self.home / "executed").read_text().splitlines(), [
            str(self.home), "start-docker.sh", self.env["ORDERS_IMAGE"],
        ])
        self.assertEqual(list(self.home.glob(".start-docker.*")), [])

    def test_create_and_run_saved_root_script(self):
        result = self.deploy()
        self.assert_started(result)
        self.assertIn("新建远端", result.stdout)
        args = json.loads((self.base / "ssh-args.json").read_text())
        self.assertIn("deploy@server.example", args)
        self.assertIn("2222", args)
        self.assertIn("StrictHostKeyChecking=yes", args)
        key = Path(args[args.index("-i") + 1])
        self.assertFalse(key.exists(), "temporary private key must be removed")

    def test_verified_digest_reaches_remote_startup_unchanged(self):
        self.env["ORDERS_IMAGE"] = "ghcr.io/c0versnow/orders3@sha256:" + "a" * 64
        self.assert_started(self.deploy())

    def test_malformed_or_shell_image_is_rejected_before_ssh(self):
        for image in ["ghcr.io/c0versnow/orders3@sha256:bad", "ghcr.io/c0versnow/orders3:latest;false", "other.example/orders:latest"]:
            with self.subTest(image=image):
                self.assertNotEqual(self.deploy(ORDERS_IMAGE=image).returncode, 0)
                self.assertFalse((self.base / "ssh-args.json").exists())

    def test_overwrite_and_run_updated_content(self):
        target = self.home / "start-docker.sh"
        target.write_text("old content that must not run\n")
        result = self.deploy()
        self.assert_started(result)
        self.assertIn("覆盖远端", result.stdout)
        self.startup.write_text(STARTUP + "# updated root script\n")
        self.assert_started(self.deploy())

    def test_startup_failure_propagates(self):
        result = self.deploy(STARTUP_EXIT="23")
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertTrue((self.home / "executed").exists())

    def test_connection_failure_leaves_existing_file(self):
        target = self.home / "start-docker.sh"
        target.write_text("old content\n")
        self.assertEqual(self.deploy(SSH_FAIL="1").returncode, 255)
        self.assertEqual(target.read_text(), "old content\n")
        self.assertFalse((self.home / "executed").exists())

    def test_invalid_local_script_is_not_uploaded(self):
        self.startup.write_text("if then\n")
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertFalse((self.base / "ssh-args.json").exists())

    def test_missing_local_script_is_not_uploaded(self):
        self.startup.unlink()
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertFalse((self.base / "ssh-args.json").exists())

    def test_remote_directory_is_not_treated_as_a_file(self):
        (self.home / "start-docker.sh").mkdir()
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertEqual(list((self.home / "start-docker.sh").iterdir()), [])
        self.assertFalse((self.home / "executed").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
