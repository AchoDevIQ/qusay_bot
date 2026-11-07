"""
Provider-neutral model router for every LLM feature (OCR, grading, feedback).

Each feature picks its model from the environment:

    OCR_MODEL / GRADING_MODEL / FEEDBACK_MODEL            primary model
    OCR_FALLBACK_MODEL / GRADING_FALLBACK_MODEL / ...    optional failover model
    MODEL_FALLBACK                                       failover for any feature without its own

A model id starting with "claude" is served by Anthropic (e.g. claude-haiku-5-5);
anything else is served by OpenAI (gpt-4o-mini, gpt-4o, gpt-5-mini, ...). When the
primary model fails after the SDK's own retries, or its provider has no API key,
the request is re-run on the fallback model, so GPT and Claude can back each other up.
"""
import asyncio
import base64
import json
import re
import logging
import os
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

FEATURES = ("ocr", "grading", "feedback", "visual")

# Branch defaults: gpt-5-mini OCR (low detail), gpt-4o-mini grading/feedback,
# gpt-5 for the Visual Red-Pen Grading Lab.
DEFAULT_MODELS = {
    "ocr": "gpt-5-mini",
    "grading": "gpt-4o-mini",
    "feedback": "gpt-4o-mini",
    "visual": "gpt-5",
}

# Reasoning effort per feature when <FEATURE>_EFFORT is unset. The visual lab grades
# a whole page in one call, so it gets more reasoning than the per-step features.
DEFAULT_EFFORT = {"visual": "medium"}

# Visible-output caps. Reasoning tokens count against max_completion_tokens on GPT-5
# models, so these leave headroom; an exhausted budget raises instead of returning "".
DEFAULT_MAX_OUTPUT_TOKENS = {"ocr": 4000, "grading": 16000, "feedback": 3000, "visual": 16000}

# Models offered in the UI. Any other id still works when set through the environment.
GPT_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5"]
CLAUDE_MODELS = ["claude-haiku-5-5"]
AVAILABLE_MODELS = GPT_MODELS + CLAUDE_MODELS

# Retries are delegated to the SDKs (both retry 408/409/429/5xx with backoff)
MAX_RETRIES = 4
REQUEST_TIMEOUT = 60.0

# Claude long-edge cap that mirrors OpenAI's detail="low" cost profile
CLAUDE_LOW_DETAIL_MAX_EDGE = 1092


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


def model_for(feature: str) -> str:
    return os.getenv(f"{feature.upper()}_MODEL") or DEFAULT_MODELS[feature]


def fallback_for(feature: str) -> Optional[str]:
    return os.getenv(f"{feature.upper()}_FALLBACK_MODEL") or os.getenv("MODEL_FALLBACK") or None


def model_chain(feature: str, model: Optional[str] = None) -> List[str]:
    """Primary model followed by the fallback (deduplicated)."""
    chain = [model or model_for(feature)]
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
# Clients (one per provider + credential, reused across calls)
# ─────────────────────────────────────────────────────────────────────────────

_clients: Dict[tuple, Any] = {}


def _openai_client():
    from openai import AsyncOpenAI
    key = os.getenv("OPENAI_API_KEY")
    cache_key = ("openai", key)
    if cache_key not in _clients:
        _clients[cache_key] = AsyncOpenAI(api_key=key, max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT)
    return _clients[cache_key]


def _anthropic_client():
    from anthropic import AsyncAnthropic
    key = os.getenv("ANTHROPIC_API_KEY")
    cache_key = ("anthropic", key)
    if cache_key not in _clients:
        # api_key=None lets the SDK resolve ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
        _clients[cache_key] = AsyncAnthropic(api_key=key, max_retries=MAX_RETRIES, timeout=REQUEST_TIMEOUT)
    return _clients[cache_key]


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
                     output_tokens=getattr(u, "output_tokens", 0) or 0)
    _log_usage(usage)
    return usage


# QMath bot: every model call of one HTTP request is collected here, so the bot can
# show what each paper cost. bot_api.py sets a fresh list per request.
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
    """Claude has no `detail` switch; low detail is emulated by capping the long edge."""
    if detail != "low":
        return image_bytes, media_type
    try:
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes, media_type
        h, w = img.shape[:2]
        if max(h, w) <= CLAUDE_LOW_DETAIL_MAX_EDGE:
            return image_bytes, media_type
        scale = CLAUDE_LOW_DETAIL_MAX_EDGE / float(max(h, w))
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        ok, enc = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        return (enc.tobytes(), "image/jpeg") if ok else (image_bytes, media_type)
    except Exception:
        return image_bytes, media_type


# ─────────────────────────────────────────────────────────────────────────────
# Provider calls
# ─────────────────────────────────────────────────────────────────────────────

async def _openai_text(model, feature, prompt, system, max_tokens) -> LLMTextResult:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    kwargs = {"model": model, "messages": messages, "max_completion_tokens": max_tokens}
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
    }
    if system:
        kwargs["system"] = system
    response = await _anthropic_client().messages.create(**kwargs)
    _check_anthropic_stop(response)
    return LLMTextResult(text=_anthropic_text(response), usage=_anthropic_usage(model, response, feature))


async def _openai_structured(model, feature, prompt, system, schema):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    kwargs = {"model": model, "messages": messages, "response_format": schema,
              "max_completion_tokens": _max_output_tokens(feature)}
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


async def _anthropic_structured(model, feature, prompt, system, schema, content_prefix=None):
    content: List[Dict[str, Any]] = list(content_prefix or [])
    content.append({"type": "text", "text": prompt})
    kwargs = {
        "model": model,
        "max_tokens": max(16000, _max_output_tokens(feature)),
        "output_config": {"effort": _effort(feature)},
        "output_format": schema,
        "messages": [{"role": "user", "content": content}],
    }
    if system:
        kwargs["system"] = system
    response = await _anthropic_client().messages.parse(**kwargs)
    _check_anthropic_stop(response)
    _anthropic_usage(model, response, feature)
    if response.parsed_output is None:
        raise LLMUnavailableError("Claude returned no parseable structured output.")
    return response.parsed_output


async def _openai_vision_json(model, feature, prompt, images, detail, system) -> dict:
    content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
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
    }
    if _is_openai_reasoning_model(model):
        kwargs["reasoning_effort"] = _effort(feature)
    response = await _openai_client().chat.completions.create(**kwargs)
    _openai_usage(model, response)
    return _parse_json_object(_openai_message_text(response))


async def _anthropic_vision_json(model, feature, prompt, images, detail, schema, system) -> dict:
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
    parsed = await _anthropic_structured(model, feature, prompt, system, schema, content_prefix=blocks)
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
            return await call(candidate, provider)
        except LLMRefusalError as e:
            attempt.errors.append(f"{candidate}: {e}")
            logger.warning(f"[{feature}] {candidate} refused; trying fallback if configured.")
        except Exception as e:
            if "Event loop is closed" in str(e):
                key = os.getenv("ANTHROPIC_API_KEY") if provider == "anthropic" else os.getenv("OPENAI_API_KEY")
                _clients.pop((provider, key), None)
                try:
                    return await call(candidate, provider)
                except Exception as retry_err:
                    e = retry_err
            attempt.errors.append(f"{candidate}: {e}")
            logger.warning(f"[{feature}] {candidate} failed ({e}); trying fallback if configured.")
    raise LLMUnavailableError(f"No model could serve '{feature}': " + "; ".join(attempt.errors))


async def complete_text(feature: str, prompt: str, *, system: Optional[str] = None,
                        max_tokens: int = 3000, model: Optional[str] = None) -> LLMTextResult:
    """Free-text completion (feedback)."""
    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_text_call(candidate, feature, prompt, system, max_tokens)
        return await _openai_text(candidate, feature, prompt, system, max_tokens)
    return await _run_chain(feature, model, call)


async def complete_structured(feature: str, prompt: str, schema: Type[T], *,
                              system: Optional[str] = None, model: Optional[str] = None) -> T:
    """Schema-validated completion (grading)."""
    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_structured(candidate, feature, prompt, system, schema)
        return await _openai_structured(candidate, feature, prompt, system, schema)
    return await _run_chain(feature, model, call)


async def complete_vision_json(feature: str, prompt: str, image_bytes: Optional[bytes] = None, *,
                               media_type: str = "image/jpeg", schema: Type[BaseModel],
                               detail: str = "low", model: Optional[str] = None,
                               images: Optional[List[tuple]] = None,
                               system: Optional[str] = None) -> dict:
    """
    Vision request returning a JSON object (OCR, visual grading).

    Pass one image via `image_bytes`/`media_type`, or several via `images` as
    (bytes, media_type, caption) tuples, captions shown before each image.
    Claude is constrained to `schema` via structured outputs; GPT uses json_object
    mode with the schema described in the prompt.
    """
    image_list = list(images or [])
    if image_bytes is not None:
        image_list.append((image_bytes, media_type, ""))
    if not image_list:
        raise ValueError("complete_vision_json needs at least one image.")

    async def call(candidate, provider):
        if provider == "anthropic":
            return await _anthropic_vision_json(candidate, feature, prompt, image_list, detail, schema, system)
        return await _openai_vision_json(candidate, feature, prompt, image_list, detail, system)
    return await _run_chain(feature, model, call)
