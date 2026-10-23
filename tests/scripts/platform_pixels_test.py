"""CI-only: edge noise is distinct from missing content, motion and recoloring."""
from pathlib import Path
import sys
import unittest
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from platform_pixels import compare_pixels


class PlatformPixelsTest(unittest.TestCase):
    def test_identical_pixels_keep_exact_match(self):
        image = Image.new('RGB', (40, 40), 'white')
        self.assertTrue(compare_pixels(image, image)['exact_match'])

    def test_only_edge_antialiasing_is_classified_and_raw_count_remains(self):
        first = Image.new('RGB', (20, 20), 'white')
        second = first.copy()
        for image, gray in [(first, 80), (second, 160)]:
            draw = ImageDraw.Draw(image)
            draw.rectangle((0, 0, 8, 19), fill='black')
            draw.line((9, 0, 9, 19), fill=(gray, gray, gray))
        result = compare_pixels(first, second)
        self.assertEqual(result['above_channel_tolerance_pixels'], 20)
        self.assertFalse(result['exact_match'])
        self.assertGreaterEqual(result['antialias_pixels'], 18)
        self.assertTrue(result['tolerance_pass'])

    def test_missing_content_moved_blocks_and_changed_colors_still_fail(self):
        original = Image.new('RGB', (40, 40), 'white')
        ImageDraw.Draw(original).rectangle((8, 8, 27, 27), fill='black')
        missing = Image.new('RGB', original.size, 'white')
        moved = missing.copy()
        ImageDraw.Draw(moved).rectangle((11, 8, 30, 27), fill='black')
        recolored = missing.copy()
        ImageDraw.Draw(recolored).rectangle((8, 8, 27, 27), fill='red')
        for name, image in [('missing', missing), ('moved', moved), ('color', recolored)]:
            with self.subTest(name=name):
                self.assertFalse(compare_pixels(original, image)['tolerance_pass'])

    def test_dimensions_cannot_be_normalized_away(self):
        with self.assertRaises(ValueError):
            compare_pixels(Image.new('RGB', (10, 10)), Image.new('RGB', (11, 10)))


if __name__ == '__main__':
    unittest.main(verbosity=2)
