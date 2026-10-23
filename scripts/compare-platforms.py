"""Remote CI: preserve exact and tolerant results independently; always write evidence."""
import json
from pathlib import Path
from PIL import Image, ImageChops
from platform_pixels import CHANNEL_TOLERANCE, MAX_DIFFERENCE_RATIO, compare_pixels

root = Path('tests/artifacts')
windows = root / 'platform-windows'
linux = root / 'platform-docker'
out = root / 'platform-diff'
out.mkdir(parents=True, exist_ok=True)
# Declared before either platform is captured, never inferred from observed differences.
report = {'channel_tolerance': CHANNEL_TOLERANCE, 'max_difference_ratio': MAX_DIFFERENCE_RATIO, 'antialias_classifier': 'pixelmatch 0.4.0', 'comparisons': []}
try:
    a = json.loads((windows / 'manifest.json').read_text())
    b = json.loads((linux / 'manifest.json').read_text())
    for key in ['commit', 'browser', 'fonts', 'deviceScaleFactor', 'timezone']:
        assert a[key] == b[key], f'{key} differs: {a[key]} / {b[key]}'
    assert len(a['cases']) == len(b['cases']) == 96
    assert [case['id'] for case in a['cases']] == [case['id'] for case in b['cases']]
    for wa, lb in zip(a['cases'], b['cases']):
        assert wa == lb, f'Layout/scroll geometry differs: {wa} / {lb}'
        for suffix, region in [('-fade', 'bottom-48px'), ('', 'full-table-viewport')]:
            name = wa['id'] + suffix + '.png'
            first, second = Image.open(windows / name).convert('RGB'), Image.open(linux / name).convert('RGB')
            assert first.size == second.size, f'{name}: dimensions differ'
            diff = ImageChops.difference(first, second)
            diff.save(out / name)
            report['comparisons'].append({'case': wa['id'], 'region': region, 'size': first.size, **compare_pixels(first, second)})
    report['passed'] = all(item['tolerance_pass'] for item in report['comparisons'])
except Exception as error:
    report.update(passed=False, error=str(error))
finally:
    (out / 'report.json').write_text(json.dumps(report, indent=2))
    comparisons = report['comparisons']
    lines = ['# Windows EXE / Linux Docker visual comparison', '', f'Channel tolerance: {CHANNEL_TOLERANCE}/255; maximum non-antialiased differing pixels: {MAX_DIFFERENCE_RATIO:.0%}. Raw differences and detected anti-aliasing are reported separately.', '', '| Case | Region | Exact differing pixels | Exact ratio | Above-tolerance pixels | Anti-alias pixels | Remaining pixels | Ratio | Pass |', '|---|---|---:|---:|---:|---:|---:|---:|---|']
    lines += [f"| {r['case']} | {r['region']} | {r['exact_difference_pixels']} | {r['exact_difference_ratio']:.4%} | {r['above_channel_tolerance_pixels']} | {r['antialias_pixels']} | {r['tolerant_difference_pixels']} | {r['tolerant_difference_ratio']:.4%} | {r['tolerance_pass']} |" for r in comparisons]
    if 'error' in report:
        lines += ['', report['error']]
    (out / 'report.md').write_text('\n'.join(lines))
assert report['passed'], 'Cross-platform comparison failed; inspect platform-diff/report.json and PNGs'
print(f"{len(report['comparisons'])} visual comparisons passed; exact matches: {sum(r['exact_match'] for r in report['comparisons'])}")
