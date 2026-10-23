"""Remote CI regressions for the screenshot producer/consumer conditions.

Evaluate the workflow's actual boolean expressions across trigger and matrix
values. This intentionally supports only the expression subset used here.
"""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/build.yml').read_text()


def job(name):
    return re.search(r'^  ' + re.escape(name) + r':\n(.*?)(?=^  [\w-]+:|\Z)', WORKFLOW, re.M | re.S)[1]


def condition(section):
    return re.search(r'^    (?:    )?if: (.+)$', section, re.M)[1]


def step(section, marker):
    return next(part for part in section.split('      - ') if marker in part)


def evaluate(expression, values):
    expression = expression.removeprefix('${{').removesuffix('}}').strip()
    expression = expression.replace('always()', 'True').replace('cancelled()', 'False')
    expression = re.sub(r"(?:github|inputs|needs|matrix)(?:\.[\w-]+|\['[\w-]+'\])+", lambda m: repr(values[m[0]]), expression)
    expression = expression.replace('&&', ' and ').replace('||', ' or ')
    expression = re.sub(r'!(?!=)', ' not ', expression)
    return bool(eval('(' + expression + ')', {'__builtins__': {}}, {}))


class WorkflowTest(unittest.TestCase):
    def test_visual_producers_and_consumers_agree_for_every_trigger(self):
        policy = re.search(r'      visual_checks: (.+)', job('publication'))[1]
        windows = job('packages')
        docker = job('container-build')
        for event, requested, expected in [('push', False, True), ('pull_request', False, True), ('workflow_dispatch', True, True), ('workflow_dispatch', False, False)]:
            with self.subTest(event=event, requested=requested):
                enabled = evaluate(policy, {'github.event_name': event, 'inputs.run_visual_checks': requested})
                self.assertEqual(enabled, expected)
                values = {'needs.publication.outputs.visual_checks': str(enabled).lower(),
                          'needs.packages.result': 'success', "needs['container-build'].result": 'success'}
                for os_name in ['windows', 'linux']:
                    values['matrix.os'] = os_name
                    for marker in ['Capture actual Windows EXE browser', 'name: platform-windows']:
                        self.assertEqual(evaluate(condition(step(windows, marker)), values), enabled and os_name == 'windows')
                for arch in ['amd64', 'arm64']:
                    values['matrix.arch'] = arch
                    for marker in ['actions/setup-node', 'Capture actual Linux Docker browser', 'name: platform-docker']:
                        self.assertEqual(evaluate(condition(step(docker, marker)), values), enabled and arch == 'amd64')
                self.assertEqual(evaluate(condition(job('visual-comparison')), values), enabled)

    def test_optional_visual_skip_cannot_mask_a_required_visual_failure(self):
        section = job('container')
        expression = re.search(r'    if: >-\n(.*?)\n    runs-on:', section, re.S)[1]
        for enabled in [True, False]:
            for result in ['success', 'skipped', 'failure', 'cancelled']:
                values = {'needs.publication.outputs.visual_checks': str(enabled).lower(), 'needs.publication.outputs.enabled': 'true',
                          'needs.checks.result': 'success', 'needs.packages.result': 'success',
                          "needs['container-build'].result": 'success', "needs['visual-comparison'].result": result}
                self.assertEqual(evaluate(expression, values), result == 'success' or (not enabled and result == 'skipped'))

    def test_patched_node_used_for_ci_container_and_source(self):
        versions = re.findall(r"node-version: '([^']+)'", WORKFLOW)
        self.assertEqual(versions, ['24.22.1'] * 3)
        self.assertEqual(re.findall(r'^FROM node:(\S+)', (ROOT / 'Dockerfile').read_text(), re.M), ['24.22.1-bookworm-slim'] * 2)
        package = json.loads((ROOT / 'package.json').read_text())
        lock = json.loads((ROOT / 'package-lock.json').read_text())
        self.assertEqual(package['engines']['node'], '>=24.22.1 <25')
        self.assertEqual(package['engines'], lock['packages']['']['engines'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
