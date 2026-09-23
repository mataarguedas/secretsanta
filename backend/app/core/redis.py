from redis.asyncio import Redis


def create_redis(url: str) -> "Redis":
    # Short timeouts so a Redis outage surfaces as a fast error (e.g. /health 503), not a hang.
    client: Redis = Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )
    return client
