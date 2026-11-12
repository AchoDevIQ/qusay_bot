"""
Time-limited symbolic math for production code paths.

simplify() and solve() can run for hours on short input and a Python thread cannot be
stopped, so the grading paths call these wrappers instead of math_engine.verifier. Work
runs in a small pool of worker processes (math_engine/worker.py). A request that exceeds
SYMPY_TIMEOUT_SECONDS has its worker killed and comes back as "uncertain", which sends
the step to the LLM grader rather than stalling the server.

These calls block, so async code must run them through asyncio.to_thread.
"""
import atexit
import json
import logging
import os
import queue
import re
import subprocess
import sys
import threading
from functools import lru_cache
from typing import Any, List, Optional, Tuple

from math_engine.verifier import VerificationResult

logger = logging.getLogger(__name__)

STARTUP_TIMEOUT_SECONDS = 60.0
SLOT_WAIT_SECONDS = 60.0
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SECRET_ENV_NAME = re.compile(r"(KEY|KEYS|TOKEN|SECRET|PASSWORD)$", re.IGNORECASE)


def _env_number(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def _timeout_seconds() -> float:
    return _env_number("SYMPY_TIMEOUT_SECONDS", 8.0)


def _worker_env() -> dict:
    """The worker handles untrusted text, so it never receives credentials."""
    return {k: v for k, v in os.environ.items() if not _SECRET_ENV_NAME.search(k)}


class SandboxTimeout(RuntimeError):
    """The worker did not answer in time and was killed."""


class _Worker:
    def __init__(self) -> None:
        self._lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._process = subprocess.Popen(
            [sys.executable, "-m", "math_engine.worker"],
            cwd=_REPO_ROOT,
            env=_worker_env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        threading.Thread(target=self._pump, daemon=True).start()
        try:
            ready = self._lines.get(timeout=STARTUP_TIMEOUT_SECONDS)
        except queue.Empty:
            ready = None
        if ready is None:
            self.kill()
            raise RuntimeError("SymPy worker failed to start.")

    def _pump(self) -> None:
        # Pipes have no read timeout on Windows, so a thread feeds a queue that does
        for line in self._process.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def call(self, op: str, args: List[str], timeout: float) -> Any:
        try:
            self._process.stdin.write(json.dumps({"op": op, "args": args, "timeout": timeout}) + "\n")
            self._process.stdin.flush()
            line = self._lines.get(timeout=timeout)
        except queue.Empty:
            raise SandboxTimeout(f"{op} exceeded {timeout:g}s")
        except OSError as e:
            raise RuntimeError(f"SymPy worker pipe failed: {e}")
        if line is None:
            raise RuntimeError("SymPy worker exited unexpectedly.")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error", "SymPy worker error"))
        return reply["result"]

    def kill(self) -> None:
        try:
            self._process.kill()
            self._process.wait(timeout=5)
        except Exception:
            pass


class _Pool:
    def __init__(self) -> None:
        self._size = int(_env_number("SYMPY_WORKERS", min(4, os.cpu_count() or 1)))
        self._slots = threading.BoundedSemaphore(self._size)
        self._idle: List[_Worker] = []
        self._lock = threading.Lock()

    def run(self, op: str, args: List[str]) -> Any:
        timeout = _timeout_seconds()
        if not self._slots.acquire(timeout=SLOT_WAIT_SECONDS):
            raise SandboxTimeout("all SymPy workers are busy")
        try:
            with self._lock:
                worker = self._idle.pop() if self._idle else None
            worker = worker or _Worker()
            try:
                result = worker.call(op, args, timeout)
            except Exception:
                # Its state is unknown (possibly mid-simplify), so it is never reused
                worker.kill()
                raise
            with self._lock:
                self._idle.append(worker)
            return result
        finally:
            self._slots.release()

    def warm_up(self) -> None:
        """Starts every worker up front: the first start imports SymPy and takes seconds."""
        with self._lock:
            missing = self._size - len(self._idle)
        for worker in [_Worker() for _ in range(missing)]:
            with self._lock:
                self._idle.append(worker)

    def shutdown(self) -> None:
        with self._lock:
            workers, self._idle = self._idle, []
        for worker in workers:
            worker.kill()


_pool = _Pool()
atexit.register(_pool.shutdown)


def warm_up() -> None:
    _pool.warm_up()


def shutdown() -> None:
    _pool.shutdown()


@lru_cache(maxsize=4096)
def verify_equivalence(expr_a: str, expr_b: str) -> VerificationResult:
    """Time-limited math_engine.verifier.verify_equivalence. Never raises."""
    try:
        return VerificationResult(**_pool.run("verify", [expr_a, expr_b]))
    except SandboxTimeout as e:
        logger.warning(f"Symbolic check abandoned: {e}")
        return VerificationResult(equivalent=None, method="timeout", status="uncertain",
                                  detail="Symbolic check timed out.")
    except Exception as e:
        logger.warning(f"Symbolic check failed: {e}")
        return VerificationResult(equivalent=None, method="worker_error", status="uncertain",
                                  detail="Symbolic check failed.")


@lru_cache(maxsize=4096)
def assignments_satisfy(prior_expr: str, assignment_exprs: Tuple[str, ...]) -> bool:
    """Time-limited math_engine.verifier.assignments_satisfy. False when it cannot be shown."""
    try:
        return bool(_pool.run("assignments_satisfy", [prior_expr, list(assignment_exprs)]))
    except Exception as e:
        logger.warning(f"Substitution check abandoned: {e}")
        return False


@lru_cache(maxsize=4096)
def solves_exactly(prior_expr: str, candidate_exprs: Tuple[str, ...]) -> bool:
    """Time-limited math_engine.verifier.solves_exactly. False when it cannot be shown."""
    try:
        return bool(_pool.run("solves_exactly", [prior_expr, list(candidate_exprs)]))
    except Exception as e:
        logger.warning(f"Carried-error check abandoned: {e}")
        return False


@lru_cache(maxsize=4096)
def value_contradicts(prior_expr: str, candidate_exprs: Tuple[str, ...]) -> bool:
    """Time-limited math_engine.verifier.value_contradicts. False when it cannot be shown."""
    try:
        return bool(_pool.run("value_contradicts", [prior_expr, list(candidate_exprs)]))
    except Exception as e:
        logger.warning(f"Rubric check abandoned: {e}")
        return False


@lru_cache(maxsize=4096)
def _final_values_cached(text: str) -> Optional[str]:
    result = _pool.run("final_values", [text])
    return json.dumps(result) if result is not None else None


def final_values(text: str) -> Optional[List[dict]]:
    """Time-limited math_engine.finals.final_values. None when the line is not values or cannot be read."""
    try:
        cached = _final_values_cached(text or "")
    except Exception as e:
        logger.warning(f"Final-answer check abandoned: {e}")
        return None
    return json.loads(cached) if cached is not None else None


@lru_cache(maxsize=1024)
def _graph_features_cached(text: str) -> Optional[str]:
    result = _pool.run("graph_features", [text])
    return json.dumps(result) if result is not None else None


def graph_features(text: str) -> Optional[dict]:
    """Time-limited math_engine.graphs.graph_features. None when it is not a function of x or cannot be worked out."""
    try:
        cached = _graph_features_cached(text or "")
    except Exception as e:
        logger.warning(f"Graph check abandoned: {e}")
        return None
    return json.loads(cached) if cached is not None else None


@lru_cache(maxsize=1024)
def _function_values_cached(text: str, xs: Tuple[float, ...]) -> Optional[str]:
    result = _pool.run("function_values", [text, list(xs)])
    return json.dumps(result) if result is not None else None


def function_values(text: str, xs) -> Optional[List[Optional[float]]]:
    """Time-limited math_engine.graphs.function_values: f at each x (None where undefined). Never raises."""
    try:
        cached = _function_values_cached(text or "", tuple(float(x) for x in xs))
    except Exception as e:
        logger.warning(f"Function values abandoned: {e}")
        return None
    return json.loads(cached) if cached is not None else None


@lru_cache(maxsize=4096)
def follows_from(prior_expr: str, candidate_expr: str) -> bool:
    """Time-limited math_engine.verifier.follows_from. False when it cannot be shown."""
    try:
        return bool(_pool.run("follows_from", [prior_expr, candidate_expr]))
    except Exception as e:
        logger.warning(f"Propagated-error check abandoned: {e}")
        return False
