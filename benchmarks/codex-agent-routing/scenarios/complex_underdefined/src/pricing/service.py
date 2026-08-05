from decimal import Decimal

from .client import UpstreamPricingClient


class PricingService:
    def __init__(self, client: UpstreamPricingClient) -> None:
        self._client = client

    def get_price(self, product_id: str, currency: str) -> Decimal:
        return self._client.fetch_price(product_id, currency)
