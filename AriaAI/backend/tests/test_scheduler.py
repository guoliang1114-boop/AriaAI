"""Tests for APScheduler service — lifecycle, next-run computation, job management."""
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

from app.services import scheduler as sched_module


class NextRunTestCase(unittest.TestCase):
    @patch("app.services.scheduler.utc_now_naive")
    def test_daily(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 12, 0, 0)
        result = sched_module.next_run_from_frequency("daily")
        self.assertEqual(result, datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc))

    @patch("app.services.scheduler.utc_now_naive")
    def test_weekly(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 12, 0, 0)
        result = sched_module.next_run_from_frequency("weekly")
        self.assertEqual(result, datetime(2025, 1, 8, 12, 0, 0, tzinfo=timezone.utc))

    @patch("app.services.scheduler.utc_now_naive")
    def test_monthly(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 12, 0, 0)
        result = sched_module.next_run_from_frequency("monthly")
        self.assertEqual(result, datetime(2025, 1, 31, 12, 0, 0, tzinfo=timezone.utc))

    @patch("app.services.scheduler.utc_now_naive")
    def test_cron_expr(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 0, 0, 0)
        result = sched_module.next_run_from_frequency("custom", "0 9 * * *")
        self.assertIsInstance(result, datetime)
        self.assertGreater(result, datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc))

    @patch("app.services.scheduler.utc_now_naive")
    def test_invalid_cron_returns_none(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 0, 0, 0)
        result = sched_module.next_run_from_frequency("custom", "not-a-cron")
        self.assertIsNone(result)

    @patch("app.services.scheduler.utc_now_naive")
    def test_unknown_frequency_no_cron_returns_none(self, mock_now):
        mock_now.return_value = datetime(2025, 1, 1, 0, 0, 0)
        result = sched_module.next_run_from_frequency("yearly")
        self.assertIsNone(result)


class SchedulerLifecycleTestCase(unittest.TestCase):
    @patch.object(sched_module, "_scheduler")
    def test_start_when_not_running(self, mock_scheduler):
        mock_scheduler.running = False
        sched_module.start()
        mock_scheduler.start.assert_called_once()

    @patch.object(sched_module, "_scheduler")
    def test_start_when_already_running(self, mock_scheduler):
        mock_scheduler.running = True
        sched_module.start()
        mock_scheduler.start.assert_not_called()

    @patch.object(sched_module, "_scheduler")
    def test_shutdown_when_running(self, mock_scheduler):
        mock_scheduler.running = True
        sched_module.shutdown()
        mock_scheduler.shutdown.assert_called_once_with(wait=False)

    @patch.object(sched_module, "_scheduler")
    def test_is_running(self, mock_scheduler):
        mock_scheduler.running = True
        self.assertTrue(sched_module.is_running())
        mock_scheduler.running = False
        self.assertFalse(sched_module.is_running())


class JobManagementTestCase(unittest.TestCase):
    @patch.object(sched_module, "_scheduler")
    def test_register_task_disabled(self, mock_scheduler):
        task = MagicMock()
        task.is_enabled = False
        sched_module.register_task(task)
        mock_scheduler.add_job.assert_not_called()

    @patch.object(sched_module, "_scheduler")
    def test_remove_task_existing(self, mock_scheduler):
        mock_scheduler.get_job.return_value = MagicMock()
        sched_module.remove_task(1)
        mock_scheduler.remove_job.assert_called_once_with("task_1")

    @patch.object(sched_module, "_scheduler")
    def test_remove_task_missing(self, mock_scheduler):
        mock_scheduler.get_job.return_value = None
        sched_module.remove_task(99)
        mock_scheduler.remove_job.assert_not_called()

    @patch.object(sched_module, "_scheduler")
    def test_remove_job_clears_metadata(self, mock_scheduler):
        sched_module._job_metadata["job_1"] = {"meta": True}
        mock_scheduler.get_job.return_value = MagicMock()
        sched_module.remove_job("job_1")
        self.assertNotIn("job_1", sched_module._job_metadata)

    @patch.object(sched_module, "_scheduler")
    def test_get_jobs(self, mock_scheduler):
        mock_scheduler.get_jobs.return_value = [MagicMock(), MagicMock()]
        jobs = sched_module.get_jobs()
        self.assertEqual(len(jobs), 2)

    @patch.object(sched_module, "_scheduler")
    def test_get_job_metadata(self, mock_scheduler):
        sched_module._job_metadata["job_x"] = {"freq": "daily"}
        meta = sched_module.get_job_metadata("job_x")
        self.assertEqual(meta["freq"], "daily")


class AddOrReplaceDateJobTestCase(unittest.TestCase):
    @patch.object(sched_module, "_scheduler")
    def test_adds_job_when_running(self, mock_scheduler):
        mock_scheduler.running = True
        sched_module.add_or_replace_date_job(
            "job_1",
            datetime(2025, 1, 1, 12, 0, 0),
            lambda: "done",
            metadata={"task": 1},
        )
        mock_scheduler.add_job.assert_called_once()
        self.assertEqual(sched_module.get_job_metadata("job_1")["task"], 1)

    @patch.object(sched_module, "_scheduler")
    def test_skips_when_not_running(self, mock_scheduler):
        mock_scheduler.running = False
        sched_module.add_or_replace_date_job(
            "job_2",
            datetime(2025, 1, 1, 12, 0, 0),
            lambda: "done",
        )
        mock_scheduler.add_job.assert_not_called()


class TriggerNowTestCase(unittest.TestCase):
    @patch("app.services.scheduler.asyncio.run")
    @patch("app.services.task_runner.run_task")
    def test_runs_task(self, mock_run_task, mock_asyncio_run):
        task = MagicMock()
        task.id = 7
        sched_module.trigger_now(task)
        mock_asyncio_run.assert_called_once()
