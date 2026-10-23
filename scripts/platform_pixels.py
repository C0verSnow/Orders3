"""PNG difference analysis; keep raw evidence and classify edge anti-aliasing."""
from PIL import ImageChops
from pixelmatch.utils import antialiased

CHANNEL_TOLERANCE = 32
MAX_DIFFERENCE_RATIO = 0.02


def compare_pixels(first, second):
    if first.size != second.size:
        raise ValueError('Image dimensions differ')
    first, second = first.convert('RGBA'), second.convert('RGBA')
    width, height = first.size
    a, b = first.tobytes(), second.tobytes()
    exact = above = aa = 0
    for index, pixel in enumerate(ImageChops.difference(first, second).getdata()):
        delta = max(pixel[:3])
        exact += delta > 0
        if delta > CHANNEL_TOLERANCE:
            above += 1
            x, y = index % width, index // width
            if antialiased(a, x, y, width, height, b) or antialiased(b, x, y, width, height, a):
                aa += 1
    total = width * height
    remaining = above - aa
    return {'pixels': total, 'exact_difference_pixels': exact,
            'exact_difference_ratio': exact / total, 'exact_match': exact == 0,
            'above_channel_tolerance_pixels': above, 'antialias_pixels': aa,
            'tolerant_difference_pixels': remaining,
            'tolerant_difference_ratio': remaining / total,
            'tolerance_pass': remaining / total <= MAX_DIFFERENCE_RATIO}
