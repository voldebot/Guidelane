from decimal import Decimal
from typing import Protocol


class UpstreamPricingClient(Protocol):
    def fetch_price(self, product_id: str, currency: str) -> Decimal:
        """Fetch the current price from the upstream pricing system."""
        ...

