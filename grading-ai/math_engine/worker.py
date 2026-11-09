"""
SymPy worker process, started by math_engine/sandbox.py.

Reads one JSON request per line on stdin and writes one JSON reply per line on stdout.
simplify() and solve() have no timeout, so they run here where the parent can kill them.
The parent removes API keys from this process's environment.
"""
import json
import os
import sys
import threading


def _exit_after(seconds: float) -> threading.Timer:
    # Backstop for when the parent has died and nobody is left to kill this process
    timer = threading.Timer(seconds, lambda: os._exit(3))
    timer.daemon = True
    timer.start()
    return timer


def main() -> None:
    protocol_out = sys.stdout
    sys.stdout = sys.stderr  # Stray prints must not corrupt the protocol stream

    from math_engine.verifier import assignments_satisfy, follows_from, verify_equivalence
    from math_engine.finals import final_values

    protocol_out.write('{"ready": true}\n')
    protocol_out.flush()

    for line in sys.stdin:
        request = json.loads(line)
        watchdog = _exit_after(float(request.get("timeout", 30)) + 5)
        try:
            if request["op"] == "verify":
                result = verify_equivalence(*request["args"]).model_dump()
            elif request["op"] == "follows_from":
                result = follows_from(*request["args"])
            elif request["op"] == "assignments_satisfy":
                result = assignments_satisfy(request["args"][0], list(request["args"][1]))
            elif request["op"] == "final_values":
                result = final_values(request["args"][0])
            else:
                result = None
            reply = {"ok": True, "result": result}
        except Exception as e:
            reply = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        finally:
            watchdog.cancel()
        protocol_out.write(json.dumps(reply) + "\n")
        protocol_out.flush()


if __name__ == "__main__":
    main()
