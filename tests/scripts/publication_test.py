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
            ('refs/tags/v1.2.3-rc.1', 'false', 'true', 'true'),
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
                self.assertEqual(values['file_version'], ref.removeprefix('refs/tags/v') if ref.startswith('refs/tags/v') else '1.0.0-build.123.1')
                if ref.endswith('v1.2.3-rc.1'):
                    self.assertEqual(values['version'], '1.2.3~rc.1')

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


    def test_release_upload_uses_one_version_for_all_five_assets_and_checksum_entries(self):
        script = block('      - name: Publish verified artifacts for this SHA', '\n  deploy:')
        for version in ['1.2.3', '1.2.3-rc.1', '1.0.0-build.123.2']:
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                release = root / 'release'
                release.mkdir()
                binaries = [f'orders-windows-x64_v-{version}.exe', f'orders3_v-{version}_amd64.deb', f'orders3_v-{version}_arm64.deb']
                for name in binaries:
                    (release / name).write_text(f'fixture: {name}')
                # Unrelated old files must never leak into a new release or its checksum list.
                (release / 'orders-windows-x64.exe').write_text('stale')
                (release / 'orders3_old_amd64.deb').write_text('stale')
                command = root / 'gh'
                command.write_text('#!/usr/bin/env bash\nset -eu\nif [[ "$2" == upload ]]; then printf "%s\\n" "$@" > "$UPLOAD_ARGS"; fi\n')
                command.chmod(0o755)
                env = {**os.environ, 'PATH': f"{root}:{os.environ['PATH']}", 'FILE_VERSION': version,
                       'TAG': f'v{version}', 'PRERELEASE': 'true' if '-' in version else 'false',
                       'IMAGE': 'ghcr.io/c0versnow/orders3', 'DIGEST': 'sha256:' + 'a' * 64,
                       'GITHUB_SHA': 'b' * 40, 'UPLOAD_ARGS': str(root / 'upload')}
                result = subprocess.run(['bash', '-c', script], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                image = f'container-image_v-{version}.txt'
                sums = f'SHA256SUMS_v-{version}.txt'
                self.assertEqual((root / 'upload').read_text().splitlines(), ['release', 'upload', f'v{version}', *binaries, image, sums, '--clobber'])
                checks = (release / sums).read_text().splitlines()
                self.assertEqual([line.split('  ', 1)[1] for line in checks], [*binaries, image])
                verified = subprocess.run(['sha256sum', '-c', sums], cwd=release, capture_output=True, text=True)
                self.assertEqual(verified.returncode, 0, verified.stderr)
                self.assertEqual((release / image).read_text().splitlines(), [f"{env['IMAGE']}:{env['TAG']}", f"{env['IMAGE']}@{env['DIGEST']}", f"commit={env['GITHUB_SHA']}"])


if __name__ == '__main__':
    unittest.main(verbosity=2)
