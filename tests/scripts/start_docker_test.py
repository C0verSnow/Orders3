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
                    'ORDERS_PULL_POLICY': 'always', 'FAKE_DOCKER_ARGS': str(self.base / 'docker-args')}
        self.command('docker', r'''case "$1" in
info) exit 0 ;;
pull) exit "${PULL_EXIT:-0}" ;;
container) exit 1 ;;
create) printf '%s\n' "$@" > "$FAKE_DOCKER_ARGS"; printf 'test-container\n' ;;
port) if [[ -n "${BINDING:-}" ]]; then printf '%s\n' "$BINDING"; else sed -n 's/^127.0.0.1:\([0-9]*\):[0-9]*$/127.0.0.1:\1/p' "$FAKE_DOCKER_ARGS"; fi ;;
stop) exit 0 ;;
start) exit "${START_EXIT:-0}" ;;
inspect) printf '%s\n' "${RUNNING:-true}" ;;
logs|rm) exit 0 ;;
*) exit 99 ;;
esac
''')
        self.command('curl', 'if [[ "$*" == *health* ]]; then printf 200; fi\nexit "${CURL_EXIT:-0}"\n')
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

    def test_infisical_env_file_is_passed_to_docker_without_shell_evaluation(self):
        env_file = self.base / 'machine credentials.env'
        env_file.write_text('INFISICAL_CLIENT_SECRET=$(touch should-not-execute)\n')
        args = self.base / 'create-args'
        self.command('docker', """case "$1" in
info|pull|start|stop|rm|logs) exit 0 ;;
container) exit 1 ;;
create) printf '%s\\n' "$@" > "$CREATE_ARGS"; printf 'test-container\\n' ;;
inspect) printf 'true\\n' ;;
port) printf '127.0.0.1:54321\\n' ;;
esac
""")
        result = self.run_script(ORDERS_ENV_FILE=str(env_file), CREATE_ARGS=str(args))
        self.assertEqual(result.returncode, 0, result.stderr)
        values = args.read_text().splitlines()
        self.assertEqual(values[values.index('--env-file') + 1], str(env_file))
        self.assertFalse((self.base / 'should-not-execute').exists())
        self.assertNotIn('INFISICAL_CLIENT_SECRET', result.stdout + result.stderr)

    def test_missing_explicit_env_file_fails_before_replacing_container(self):
        result = self.run_script(ORDERS_ENV_FILE=str(self.base / 'missing.env'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('文件不存在', result.stderr)

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

    def test_inspected_binding_is_the_recorded_port(self):
        result = self.run_script(BINDING='127.0.0.1:54321')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.base / 'docker.md').read_text(), '本地看板：\n127.0.0.1:54321\n')

    def test_public_or_ambiguous_binding_preserves_old_file(self):
        for binding in ['0.0.0.0:54321', '127.0.0.1:54321\n[::]:54321']:
            (self.base / 'docker.md').write_text('old')
            result = self.run_script(BINDING=binding)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((self.base / 'docker.md').read_text(), 'old')

    def test_readiness_failure_has_state_and_http_diagnostics(self):
        result = self.run_script(CURL_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('部署诊断', result.stderr)
        self.assertIn('last_http=', result.stderr)
        self.assertNotIn('Config.Env', result.stderr)

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
