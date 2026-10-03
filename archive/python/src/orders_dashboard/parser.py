"""Parse order blocks without losing numeric precision or units."""
import re


def parse_orders(data):
    """Extract each order block; retain units and decimal precision as text."""
    if not isinstance(data, str):
        return []
    starts = list(re.finditer(r"\bSymbol\s*:\s*([^\r\n]+)", data, re.IGNORECASE))
    orders = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(data)
        block = data[match.start():end]

        def field(name):
            found = re.search(r"\b" + name + r"\s*:\s*([^\r\n]+)", block, re.IGNORECASE)
            return found[1].strip() if found else None

        timestamp = field("Orders Times")
        orders.append((match[1].strip(), field("Price"), field("Side"),
                       field("Size"), field("Value"), timestamp))
    return orders
