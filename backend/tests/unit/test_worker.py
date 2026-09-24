from app.worker.settings import WorkerSettings
from app.worker.tasks import delete_objects, delete_prefix, ping


async def test_ping_task() -> None:
    assert await ping({}) == "pong"


def test_worker_settings_register_the_tasks() -> None:
    for task in (ping, delete_objects, delete_prefix):
        assert task in WorkerSettings.functions
    assert WorkerSettings.redis_settings.database == 15  # conftest points REDIS_URL at DB 15
