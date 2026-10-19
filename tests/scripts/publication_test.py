"""CI-only execution of actual workflow shell blocks using a registry double."""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = (REPO / '.github/workflows/build.yml').read_text()


def block(step, end):
    section = WORKFLOW.split(step, 1)[1].split(end, 1)[0]
    return textwrap.dedent(section.split('        run: |\n', 1)[1])


class PublicationTest(unittest.TestCase):
    def test_branch_rename_and_preview_publication(self):
        script = block('      - name: Select a traceable version', '\n  checks:')
        for ref, preview, enabled, prerelease in [
            ('refs/heads/main', 'false', 'true', 'true'),
            ('refs/heads/future-default', 'false', 'true', 'true'),
            ('refs/heads/feature/test', 'false', 'false', 'true'),
            ('refs/heads/feature/test', 'true', 'true', 'true'),
            ('refs/pull/34/merge', 'false', 'false', 'true'),
            ('refs/tags/v1.2.3', 'false', 'true', 'false'),
        ]:
            with self.subTest(ref=ref), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'output'
                env = {**os.environ, 'GITHUB_REF': ref, 'PREVIEW': preview,
                       'DEFAULT_BRANCH': 'future-default' if 'future-default' in ref else 'main',
                       'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_OUTPUT': str(output)}
                result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in output.read_text().splitlines())
                self.assertEqual(values['enabled'], enabled)
                self.assertEqual(values['prerelease'], prerelease)

    def test_latest_tags_follow_default_branch_and_never_feature_preview(self):
        script = block('      - id: manifest', '\n  release:')
        for ref, prerelease, latest in [('refs/heads/main', 'true', True), ('refs/heads/feature/test', 'true', False), ('refs/tags/v1.2.3', 'false', True)]:
            with self.subTest(ref=ref), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'digests').mkdir()
                for char in ['a', 'b']:
                    (root / 'digests' / (char * 64)).touch()
                binary = root / 'docker'
                binary.write_text('''#!/usr/bin/env bash
set -eu
if [[ "$3" == create ]]; then printf '%s\\n' "$@" > "$REGISTRY_ARGS";
elif [[ "$*" == *--raw* ]]; then printf '%s\\n' '{"manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"linux","architecture":"arm64"}}]}';
else printf 'sha256:%064d\\n' 0; fi
''')
                binary.chmod(0o755)
                env = {**os.environ, 'PATH': f"{root}:{os.environ['PATH']}", 'GITHUB_REF': ref, 'GITHUB_SHA': 'c' * 40,
                       'DEFAULT_BRANCH': 'main', 'PRERELEASE': prerelease, 'IMAGE': 'ghcr.io/c0versnow/orders3',
                       'VERSION': 'test-version', 'GITHUB_OUTPUT': str(root / 'output'), 'REGISTRY_ARGS': str(root / 'args')}
                result = subprocess.run(['bash', '-c', script], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                args = (root / 'args').read_text().splitlines()
                self.assertEqual('ghcr.io/c0versnow/orders3:latest' in args, latest)
                self.assertEqual('ghcr.io/c0versnow/orders3:main' in args, ref == 'refs/heads/main')


if __name__ == '__main__':
    unittest.main(verbosity=2)
