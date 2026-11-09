"""
Model router for every LLM feature (OCR, grading, feedback, visual).

Every feature runs on Claude Haiku 5.5 (claude-haiku-5-5). A model chosen on the Settings page,
in <FEATURE>_MODEL, or passed by a caller is used only if it is Haiku 5.5; anything else is
replaced by Haiku 5.5 with a warning, and a non-Haiku fallback model is ignored.

ALLOW_NON_HAIKU_MODELS=1 lifts that rule (for tests, or a deliberate emergency failover):
then OCR_MODEL / GRADING_MODEL / ..., <FEATURE>_FALLBACK_MODEL and MODEL_FALLBACK may name
other models. A model id starting with "claude" is served by Anthropic, anything else by
OpenAI. When the primary model fails after the SDK's own retries, or has no API key, the
request is re-run on the fallback model.
"""
import asyncio
import base64
import json
import re
import logging
import os
import weakref
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

FEATURES = ("ocr", "grading", "feedback", "visual")

# Claude Haiku 5.5 for every feature (reading the page, grading, feedback, visual).
HAIKU = "claude-haiku-5-5"
DEFAULT_MODELS = {"ocr": HAIKU, "grading": HAIKU, "feedback": HAIKU, "visual": HAIKU}

# Reasoning effort per feature when <FEATURE>_EFFORT is unset. Grading and the visual lab
# judge mathematics, so they run at "medium" (Claude Haiku 5.5's own default); at "low"
# the model is more likely to skip a check. Reading the page and feedback stay "low".
DEFAULT_EFFORT = {"grading": "medium", "visual": "medium"}

# Visible-output caps. Reasoning tokens count against max_completion_tokens on GPT-5
# models, so these leave headroom; an exhausted budget raises instead of returning "".
DEFAULT_MAX_OUTPUT_TOKENS = {"ocr": 4000, "grading": 16000, "feedback": 3000, "visual": 16000}

# Models the app, the API and the router accept. GPT models only with ALLOW_NON_HAIKU_MODELS=1.
CLAUDE_MODELS = [HAIKU]
GPT_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5"]
AVAILABLE_MODELS = CLAUDE_MODELS


def non_haiku_allowed() -> bool:
    return os.getenv("ALLOW_NON_HAIKU_MODELS", "").strip().lower() in ("1", "true", "yes")


def offered_models() -> List[str]:
    """Models to offer in pickers and accept from API callers."""
    return CLAUDE_MODELS + (GPT_MODELS if non_haiku_allowed() else [])


_warned_models: set = set()


def _haiku_only(model: Optional[str], where: str) -> Optional[str]:
    """The model to use: Haiku 5.5 unless another model is explicitly allowed."""
    if not model or model in CLAUDE_MODELS or non_haiku_allowed():
        return model
    if (model, where) not in _warned_models:
        _warned_models.add((model, where))
        logger.warning(f"{where}: '{model}' is not Claude Haiku 5.5; using {HAIKU} "
                       "(set ALLOW_NON_HAIKU_MODELS=1 to allow other models).")
    return HAIKU

# Retries are delegated to the SDKs (both retry 408/409/429/5xx with backoff)
MAX_RETRIES = 3
REQUEST_TIMEOUT = 60.0
# Per-request timeouts: whole-page visual grading with a reasoning model can take minutes,
# and a 60s cap made those calls time out and retry. <FEATURE>_TIMEOUT_SECONDS overrides.
DEFAULT_TIMEOUTS = {"ocr": 120.0, "grading": 120.0, "feedback": 60.0, "visual": 300.0}
# Concurrent model calls per event loop (LLM_MAX_CONCURRENCY): a large bulk upload
# otherwise fires every request at once and runs into provider rate limits.
DEFAULT_MAX_CONCURRENCY = 16

# Saved choices from the Settings page (data/settings.json) win over .env, for the API
# and the app alike. GRADING_SETTINGS_FILE points elsewhere (tests use it).
_SETTING_FOR_FEATURE = {"ocr": "ocr_model", "grading": "grading_model",
                        "feedback": "feedback_model", "visual": "visual_grading_model"}
_settings_cache: Dict[str, Any] = {"path": None, "mtime": None, "data": {}}

# Claude long-edge cap that mirrors OpenAI's detail="low" cost profile
CLAUDE_LOW_DETAIL_MAX_EDGE = 1092
# Every other detail level: the API rejects images over 5 MB, and phone photos often are.
# Pages are shrunk to this long edge (and re-encoded until under the byte cap); handwriting
# stays readable well above the model's own working resolution.
CLAUDE_HIGH_DETAIL_MAX_EDGE = 2400
CLAUDE_MAX_IMAGE_BYTES = 4_500_000


class LLMUnavailableError(RuntimeError):
    """Raised when no configured model could serve the request."""


class LLMRefusalError(RuntimeError):
    """Raised when a model declines the request."""


@dataclass
class LLMUsage:
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass
class LLMTextResult:
    text: str
    usage: LLMUsage


@dataclass
class _Attempt:
    errors: List[str] = field(default_factory=list)


def provider_for(model: str) -> str:
    return "anthropic" if model.strip().lower().startswith("claude") else "openai"


def has_credentials(provider: str) -> bool:
    if provider == "anthropic":
        return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    return bool(os.getenv("OPENAI_API_KEY"))


def any_credentials() -> bool:
    return has_credentials("openai") or has_credentials("anthropic")


def _settings_path() -> str:
    return os.getenv("GRADING_SETTINGS_FILE") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "settings.json")


def saved_settings() -> Dict[str, Any]:
    """data/settings.json, re-read only when it changes."""
    path = _settings_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    if _settings_cache["path"] != path or _settings_cache["mtime"] != mtime:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        _settings_cache.update(path=path, mtime=mtime, data=data if isinstance(data, dict) else {})
    return _settings_cache["data"]


def model_for(feature: str) -> str:
    saved = saved_settings().get(_SETTING_FOR_FEATURE.get(feature, ""))
    chosen = saved or os.getenv(f"{feature.upper()}_MODEL") or DEFAULT_MODELS[feature]
    return _haiku_only(chosen, f"{feature} model")


def fallback_for(feature: str) -> Optional[str]:
    if os.getenv(f"{feature.upper()}_FALLBACK_MODEL"):
        fallback = os.getenv(f"{feature.upper()}_FALLBACK_MODEL")
    else:
        settings = saved_settings()
        fallback = (settings["fallback_model"] or None) if "fallback_model" in settings else (os.getenv("MODEL_FALLBACK") or None)
    if fallback and fallback not in CLAUDE_MODELS and not non_haiku_allowed():
        return None  # a GPT failover would break the Haiku-only rule; Haiku has no other fallback
    return fallback


def _timeout(feature: str) -> float:
    try:
        return float(os.getenv(f"{feature.upper()}_TIMEOUT_SECONDS", ""))
    except ValueError:
        return DEFAULT_TIMEOUTS.get(feature, REQUEST_TIMEOUT)


def model_chain(feature: str, model: Optional[str] = None) -> List[str]:
    """Primary model followed by the fallback (deduplicated)."""
    chain = [_haiku_only(model, f"{feature} model override") or model_for(feature)]
    fallback = fallback_for(feature)
    if fallback and fallback not in chain:
        chain.append(fallback)
    return chain


def _effort(feature: str) -> str:
    # <FEATURE>_EFFORT, or the older <FEATURE>_REASONING_EFFORT name, else the feature default
    name = feature.upper()
    return (os.getenv(f"{name}_EFFORT") or os.getenv(f"{name}_REASONING_EFFORT")
            or DEFAULT_EFFORT.get(feature, "low"))


def _max_output_tokens(feature: str) -> int:
    try:
        return int(os.getenv(f"{feature.upper()}_MAX_OUTPUT_TOKENS", ""))
    except ValueError:
        return DEFAULT_MAX_OUTPUT_TOKENS.get(feature, 4000)


def _is_openai_reasoning_model(model: str) -> bool:
    return any(k in model for k in ("gpt-5", "o1", "o3", "o4"))


# ─────────────────────────────────────────────────────────────────────────────
# Clients: one per provider + credential + event loop. An httpx client belongs to the loop
# that created it, and Streamlit runs every call in a new loop (asyncio.run), so sharing
# one across loops failed with "Event loop is closed".
# ─────────────────────────────────────────────────────────────────────────────

# Explicitly injected clients (tests use this); they take precedence over the loop cache
_clients: Dict[tuple, Any] = {}
_loop_clients: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[tuple, Any]]" = weakref.WeakKeyDictionary()
_loop_limits: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _client(provider: str, key: Optional[str], factory):
    cache_key = (provider, key)
    if cache_key in _clients:
        return _clients[cache_key]
    per_loop = _loop_clients.setdefault(asyncio.get_running_loop(), {})
    if cache_key not in per_loop:
        per_loop[cache_key] = factory()
    return per_loop[cache_key]


def _openai_client():
    from openai import AsyncOpenAI
    key = os.getenv("OPENAI_API_KEY")
    return _client("openai", key, lambda: AsyncOpenAI(api_key=key, max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT))


def _anthropic_client():
    from anthropic import AsyncAnthropic
    key = os.getenv("ANTHROPIC_API_KEY")
    # api_key=None lets the SDK resolve ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
    return _client("anthropic", key, lambda: AsyncAnthropic(api_key=key, max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT))


def _concurrency_limit() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _loop_limits:
        try:
            size = max(1, int(os.getenv("LLM_MAX_CONCURRENCY", "") or DEFAULT_MAX_CONCURRENCY))
        except ValueError:
            size = DEFAULT_MAX_CONCURRENCY
        _loop_limits[loop] = asyncio.Semaphore(size)
    return _loop_limits[loop]


# ─────────────────────────────────────────────────────────────────────────────
# Usage helpers
# ─────────────────────────────────────────────────────────────────────────────

def _openai_usage(model: str, response) -> LLMUsage:
    u = getattr(response, "usage", None)
    reasoning = getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", 0) or 0
    usage = LLMUsage(model=model, provider="openai",
                     input_tokens=getattr(u, "prompt_tokens", 0) or 0,
                     output_tokens=getattr(u, "completion_tokens", 0) or 0,
                     reasoning_tokens=reasoning)
    _log_usage(usage)
    return usage


def _anthropic_usage(model: str, response, feature: str = "") -> LLMUsage:
    u = getattr(response, "usage", None)
    usage = LLMUsage(model=model, provider="anthropic",
                     input_tokens=getattr(u, "input_tokens", 0) or 0,
                     output_tokens=getattr(u, "output_tokens", 0) or 0,
                     cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
                     cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0)
    _log_usage(usage)
    return usage


# Every model call of one request is collected here when a caller sets a list (the QMath
# bot reports what each paper cost). ContextVar keeps concurrent requests apart.
USAGE_COLLECTOR: ContextVar[Optional[list]] = ContextVar("usage_collector", default=None)


def _log_usage(usage: LLMUsage) -> None:
    bucket = USAGE_COLLECTOR.get()
    if bucket is not None:
        bucket.append(usage)
    logger.info(
        f"LLM [{usage.provider}:{usage.model}] tokens: input={usage.input_tokens}, "
        f"output={usage.output_tokens} (reasoning={usage.reasoning_tokens})"
    )


def _check_anthropic_stop(response) -> None:
    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        category = getattr(details, "category", None) if details else None
        raise LLMRefusalError(f"Claude declined the request (category: {category or 'unknown'}).")
    if response.stop_reason == "max_tokens":
        raise LLMUnavailableError("Claude response was cut off at max_tokens.")


def _anthropic_text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text").strip()


def _openai_message_text(response) -> str:
    """Visible text of a chat completion; raises when the token budget ate the answer."""
    choice = response.choices[0]
    text = (choice.message.content or "").strip()
    if not text and getattr(choice, "finish_reason", None) == "length":
        raise LLMUnavailableError(
            "Output token budget exhausted before any visible output "
            "(reasoning tokens count against max_completion_tokens); raise <FEATURE>_MAX_OUTPUT_TOKENS."
        )
    refusal = getattr(choice.message, "refusal", None)
    if not text and refusal:
        raise LLMRefusalError(f"Model refused: {refusal}")
    return text


def _parse_json_object(text: str) -> dict:
    """Tolerant JSON decoding: whole text, else the outermost {...} block."""
    if not text:
        raise LLMUnavailableError("Model returned an empty response.")
    try:
        data = json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            raise LLMUnavailableError(f"Model returned non-JSON output: {text[:120]!r}")
        data = json.loads(m.group(0))
    return data if isinstance(data, dict) else {"steps": data}


# ─────────────────────────────────────────────────────────────────────────────
# Image helpers
# ─────────────────────────────────────────────────────────────────────────────

def _downscale_for_claude(image_bytes: bytes, media_type: str, detail: str) -> tuple:
    """
    Claude has no `detail` switch: low detail caps the long edge at 1092 px, any other
    level at CLAUDE_HIGH_DETAIL_MAX_EDGE, and the result is kept under the 5 MB API limit.
    Images that are already small enough are sent unchanged.
    """
    max_edge = CLAUDE_LOW_DETAIL_MAX_EDGE if detail == "low" else CLAUDE_HIGH_DETAIL_MAX_EDGE
    try:
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes, media_type
        h, w = img.shape[:2]
        if max(h, w) <= max_edge and len(image_bytes) <= CLAUDE_MAX_IMAGE_BYTES:
            return image_bytes, media_type
        if max(h, w) > max_edge:
            scale = max_edge / float(max(h, w))
            img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        for quality in (90, 80, 70, 60):
            ok, enc = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
            if ok and len(enc) <= CLAUDE_MAX_IMAGE_BYTES:
                return enc.tobytes(), "image/jpeg"
        return image_bytes, media_type
    except Exception:
        return image_bytes, media_type


def _anthropic_system(system: Optional[str], cache_system: bool):
    """A long, repeated system prompt (a teacher's booklet) is cached: later calls read it at a tenth of the price."""
    if not system or not cache_system:
        return system
    return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]


# ─────────────────────────────────────────────────────────────────────────────
# Provider calls
# ─────────────────────────────────────────────────────────────────────────────

async def _openai_text(model, feature, prompt, system, max_tokens) -> LLMTextResult:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    kwargs = {"model": model, "messages": messages, "max_completion_tokens": max_tokens, "timeout": _timeout(feature)}
    if _is_openai_reasoning_model(model):
        kwargs["reasoning_effort"] = _effort(feature)
    response = await _openai_client().chat.completions.create(**kwargs)
    usage = _openai_usage(model, response)
    return LLMTextResult(text=_openai_message_text(response), usage=usage)


async def _anthropic_text_call(model, feature, prompt, system, max_tokens) -> LLMTextResult:
    kwargs = {
        "model": model,
        "max_tokens": max_tokens,
        "output_config": {"effort": _effort(feature)},
        "messages": [{"role": "user", "content": prompt}],
        "timeout": _timeout(feature),
    }
    if system:
        kwargs["system"] = system
    response = await _anthropic_client().messages.create(**kwargs)
    _check_anthropic_stop(response)
    return LLMTextResult(text=_anthropic_text(response), usage=_anthropic_usage(model, response, feature))


async def _openai_structured(model, feature, prompt, system, schema):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    kwargs = {"model": model, "messages": messages, "response_format": schema,
              "max_completion_tokens": _max_output_tokens(feature), "timeout": _timeout(feature)}
    if _is_openai_reasoning_model(model):
        kwargs["reasoning_effort"] = _effort(feature)
    response = await _openai_client().chat.completions.parse(**kwargs)
    _openai_usage(model, response)
    message = response.choices[0].message
    if message.parsed is None:
        if getattr(response.choices[0], "finish_reason", None) == "length":
            raise LLMUnavailableError("Output token budget exhausted before the structured result was complete.")
        raise LLMRefusalError(f"Model refused: {message.refusal or 'unknown reason'}")
    return message.parsed


async def _anthropic_structured(model, feature, prompt, system, schema, content_prefix=None, cache_system=False):
    content: List[Dict[str, Any]] = list(content_prefix or [])
    content.append({"type": "text", "text": prompt})
    kwargs = {
        "model": model,
        "max_tokens": max(16000, _max_output_tokens(feature)),
        "output_config": {"effort": _effort(feature)},
        "output_format": schema,
        "messages": [{"role": "user", "content": content}],
        "timeout": _timeout(feature),
    }
    if system:
        kwargs["system"] = _anthropic_system(system, cache_system)
    response = await _anthropic_client().messages.parse(**kwargs)
    _check_anthropic_stop(response)
    _anthropic_usage(model, response, feature)
    if response.parsed_output is None:
        raise LLMUnavailableError("Claude returned no parseable structured output.")
    return response.parsed_output


def _with_json_schema(prompt: str, schema: Optional[Type[BaseModel]]) -> str:
    """
    OpenAI's json_object mode needs the word "json" in the messages and does not take a schema,
    so the answer's shape is spelled out in the prompt (Claude gets it as a structured output).
    Without this, prompts written for Claude fail on a GPT fallback model.
    """
    if schema is None:
        return prompt
    return (prompt + "\n\nReply with one JSON object that matches this JSON Schema exactly:\n"
            + json.dumps(schema.model_json_schema(), ensure_ascii=False))


async def _openai_vision_json(model, feature, prompt, images, detail, system, schema=None) -> dict:
    content: List[Dict[str, Any]] = [{"type": "text", "text": _with_json_schema(prompt, schema)}]
    for image_bytes, media_type, caption in images:
        if caption:
            content.append({"type": "text", "text": caption})
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        content.append({"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}", "detail": detail}})
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": content}]
    kwargs = {
        "model": model,
        # json_object mode: the prompt carries its own schema, and callers parse
        # tolerantly because models return a few different shapes
        "response_format": {"type": "json_object"},
        "messages": messages,
        "max_completion_tokens": _max_output_tokens(feature),
        "timeout": _timeout(feature),
    }
    if _is_openai_reasoning_model(model):
        kwargs["reasoning_effort"] = _effort(feature)
    response = await _openai_client().chat.completions.create(**kwargs)
    _openai_usage(model, response)
    return _parse_json_object(_openai_message_text(response))


async def _anthropic_vision_json(model, feature, prompt, images, detail, schema, system, cache_system=False) -> dict:
    blocks: List[Dict[str, Any]] = []
    for image_bytes, media_type, caption in images:
        if caption:
            blocks.append({"type": "text", "text": caption})
        image_bytes, media_type = _downscale_for_claude(image_bytes, media_type, detail)
        blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type,
                       "data": base64.standard_b64encode(image_bytes).decode("utf-8")},
        })
    parsed = await _anthropic_structured(model, feature, prompt, system, schema, content_prefix=blocks,
                                         cache_system=cache_system)
    return parsed.model_dump()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def _run_chain(feature: str, model: Optional[str], call):
    attempt = _Attempt()
    for candidate in model_chain(feature, model):
        provider = provider_for(candidate)
        if not has_credentials(provider):
            attempt.errors.append(f"{candidate}: no {provider} credentials configured")
            continue
        try:
            async with _concurrency_limit():
                return await call(candidate, provider)
        except LLMRefusalError as e:
            attempt.errors.append(f"{candidate}: {e}")
            logger.warning(f"[{feature}] {candidate} refused; trying fallback if configured.")
        except Exception as e:
            attempt.errors.append(f"{candidate}: {e}")
            logger.warning(f"[{feature}] {candidate} failed ({e}); trying fallback if configured.")
    raise LLMUnavailableError(f"No model could serve '{feature}': " + "; ".join(attempt.errors))


async def complete_text(feature: str, prompt: str, *, system: Optional[str] = None,
                        max_tokens: Optional[int] = None, model: Optional[str] = None) -> LLMTextResult:
    """Free-text completion (feedback). max_tokens defaults to <FEATURE>_MAX_OUTPUT_TOKENS."""
    max_tokens = max_tokens or _max_output_tokens(feature)

    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_text_call(candidate, feature, prompt, system, max_tokens)
        return await _openai_text(candidate, feature, prompt, system, max_tokens)
    return await _run_chain(feature, model, call)


async def complete_structured(feature: str, prompt: str, schema: Type[T], *,
                              system: Optional[str] = None, model: Optional[str] = None,
                              cache_system: bool = False) -> T:
    """Schema-validated completion (grading). cache_system caches a long, repeated system prompt on Claude."""
    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_structured(candidate, feature, prompt, system, schema, cache_system=cache_system)
        return await _openai_structured(candidate, feature, prompt, system, schema)
    return await _run_chain(feature, model, call)


async def complete_vision_json(feature: str, prompt: str, image_bytes: Optional[bytes] = None, *,
                               media_type: str = "image/jpeg", schema: Type[BaseModel],
                               detail: str = "low", model: Optional[str] = None,
                               images: Optional[List[tuple]] = None,
                               system: Optional[str] = None, cache_system: bool = False) -> dict:
    """
    Vision request returning a JSON object (OCR, visual grading).

    Pass one image via `image_bytes`/`media_type`, or several via `images` as
    (bytes, media_type, caption) tuples, captions shown before each image.
    Claude is constrained to `schema` via structured outputs; GPT uses json_object
    mode with the schema described in the prompt. cache_system caches a long, repeated
    system prompt on Claude.
    """
    image_list = list(images or [])
    if image_bytes is not None:
        image_list.append((image_bytes, media_type, ""))
    if not image_list:
        raise ValueError("complete_vision_json needs at least one image.")

    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_vision_json(candidate, feature, prompt, image_list, detail, schema, system,
                                                cache_system=cache_system)
        return await _openai_vision_json(candidate, feature, prompt, image_list, detail, system, schema=schema)
    return await _run_chain(feature, model, call)
