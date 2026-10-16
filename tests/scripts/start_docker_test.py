"""CI regression for the real startup script with Docker/curl command doubles."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class StartDockerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.env = {**os.environ, 'PATH': f"{self.bin}:{os.environ['PATH']}",
                    'ORDERS_PULL_POLICY': 'always'}
        self.command('docker', '''case "$1" in
info) exit 0 ;;
pull) exit "${PULL_EXIT:-0}" ;;
container) exit 1 ;;
create) printf 'test-container\\n' ;;
start) exit "${START_EXIT:-0}" ;;
inspect) printf '%s\\n' "${RUNNING:-true}" ;;
logs|rm) exit 0 ;;
*) exit 99 ;;
esac
''')
        self.command('curl', 'exit "${CURL_EXIT:-0}"\n')
        self.command('sleep', 'exit 0\n')

    def command(self, name, body):
        path = self.bin / name
        path.write_text('#!/usr/bin/env bash\nset -eu\n' + body)
        path.chmod(0o755)

    def run_script(self, **env):
        return subprocess.run(['bash', str(REPO / 'start-docker.sh'), '--cached'],
                              cwd=self.base, env={**self.env, **env},
                              capture_output=True, text=True, timeout=15)

    def test_creates_record_from_actual_success_output(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        line = next(line for line in result.stdout.splitlines() if line.startswith('本地看板：'))
        self.assertRegex(line, r'^本地看板：http://127\.0\.0\.1:\d+/$')
        address = line.removeprefix('本地看板：http://').removesuffix('/')
        self.assertEqual((self.base / 'docker.md').read_text(), f'本地看板：\n{address}\n')
        self.assertEqual(list(self.base.glob('.docker.md.*')), [])

    def test_overwrites_old_record(self):
        (self.base / 'docker.md').write_text('old address\n')
        self.test_creates_record_from_actual_success_output()

    def test_failures_preserve_record(self):
        target = self.base / 'docker.md'
        for failure in ({'PULL_EXIT': '1'}, {'START_EXIT': '1'},
                        {'RUNNING': 'false'}, {'CURL_EXIT': '1'}):
            with self.subTest(failure=failure):
                target.write_text('old address\n')
                result = self.run_script(**failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(target.read_text(), 'old address\n')
                self.assertNotIn('本地看板：', result.stdout)

    def test_failed_deploy_does_not_create_record(self):
        self.assertNotEqual(self.run_script(PULL_EXIT='1').returncode, 0)
        self.assertFalse((self.base / 'docker.md').exists())

    def test_directory_is_rejected(self):
        (self.base / 'docker.md').mkdir()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('docker.md 是目录', result.stderr)
        self.assertEqual(list((self.base / 'docker.md').iterdir()), [])

    def test_write_failure_preserves_record(self):
        (self.base / 'docker.md').write_text('old address\n')
        self.command('mktemp', '''if [[ "$#" == 0 ]]; then
exec /usr/bin/mktemp
fi
exit 1
''')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('无法创建看板地址临时文件', result.stderr)
        self.assertEqual((self.base / 'docker.md').read_text(), 'old address\n')


if __name__ == '__main__':
    unittest.main(verbosity=2)
