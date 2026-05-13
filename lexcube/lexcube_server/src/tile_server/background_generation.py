from __future__ import annotations

import asyncio
import logging
from typing import Callable

from .constants import DEFAULT_PRE_GENERATION_THREADS

logger = logging.getLogger("lexcube")


class PreGenerationTask:
    __slots__ = ("label", "cache_check", "generate", "_asyncio_task")

    def __init__(self, label: str, cache_check: Callable[[], bool], generate: Callable) -> None:
        self.label = label
        self.cache_check = cache_check
        self.generate = generate
        self._asyncio_task: asyncio.Task | None = None


class BackgroundGenerationManager:
    def __init__(self, max_parallel: int = DEFAULT_PRE_GENERATION_THREADS) -> None:
        self._max_parallel = max_parallel
        self._scheduled: list[PreGenerationTask] = []
        self._running: list[PreGenerationTask] = []
        self._done: list[PreGenerationTask] = []
        self._cancelled = False
        self._scheduler_future: asyncio.Task | None = None

    def schedule(self, candidates: list[PreGenerationTask]) -> None:
        new_count = 0
        hit_count = 0
        for c in candidates:
            if c.cache_check():
                hit_count += 1
            else:
                self._scheduled.append(c)
                new_count += 1
        logger.debug(
            "[BGM] schedule(): +%d queued, %d cache hits | scheduled=%d running=%d done=%d",
            new_count, hit_count,
            len(self._scheduled), len(self._running), len(self._done),
        )
        if new_count > 0:
            self._ensure_scheduler_running()

    def cancel(self) -> None:
        n_sched = len(self._scheduled)
        n_run = len(self._running)
        self._cancelled = True
        for task in list(self._running):
            if task._asyncio_task and not task._asyncio_task.done():
                task._asyncio_task.cancel()
        self._scheduled.clear()
        self._running.clear()
        self._done.clear()
        logger.debug(
            "[BGM] cancel(): cleared %d scheduled + %d running -> all lists empty",
            n_sched, n_run,
        )

    def _ensure_scheduler_running(self) -> None:
        if self._scheduler_future is None or self._scheduler_future.done():
            self._cancelled = False
            self._scheduler_future = asyncio.ensure_future(self._run_scheduler())

    async def _run_scheduler(self) -> None:
        logger.debug(
            "[BGM] Scheduler started | scheduled=%d max_parallel=%d",
            len(self._scheduled), self._max_parallel,
        )
        status_logger = asyncio.ensure_future(self._log_status_periodically())
        try:
            while not self._cancelled and (self._scheduled or self._running):
                while not self._cancelled and self._scheduled and len(self._running) < self._max_parallel:
                    task = self._scheduled.pop(0)
                    task._asyncio_task = asyncio.ensure_future(self._run_single(task))
                    self._running.append(task)
                if self._running and not self._cancelled:
                    active = [t._asyncio_task for t in self._running if t._asyncio_task is not None]
                    if active:
                        await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
                if not self._cancelled:
                    completed = [t for t in self._running if t._asyncio_task is not None and t._asyncio_task.done()]
                    for t in completed:
                        self._running.remove(t)
                        self._done.append(t)
        finally:
            status_logger.cancel()
            logger.debug(
                "[BGM] Scheduler stopped | scheduled=%d running=%d done=%d",
                len(self._scheduled), len(self._running), len(self._done),
            )

    async def _log_status_periodically(self) -> None:
        while True:
            await asyncio.sleep(10)
            logger.debug(
                "[BGM] Status | scheduled=%d running=%d done=%d",
                len(self._scheduled), len(self._running), len(self._done),
            )

    async def _run_single(self, task: PreGenerationTask) -> None:
        try:
            await task.generate()
        except asyncio.CancelledError:
            logger.debug("[BGM] Cancelled: %s", task.label)
            raise
        except Exception as e:
            logger.warning("[BGM] Failed: %s -> %s", task.label, e)
