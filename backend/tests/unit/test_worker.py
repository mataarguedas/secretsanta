from app.worker.settings import WorkerSettings
from app.worker.tasks import ping


async def test_ping_task() -> None:
    assert await ping({}) == "pong"


def test_worker_settings_register_ping() -> None:
    assert ping in WorkerSettings.functions
    assert WorkerSettings.redis_settings.database == 15  # conftest points REDIS_URL at DB 15
